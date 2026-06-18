import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { posts, Posts } from '../../db/schema/posts';
import { CreatePostDto } from './dto/create-post.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { QueryPostDto } from './dto/query-post.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class PostService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryPostDto): Promise<PaginatedData<Posts>> {
    const { page, pageSize, title, published_at, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(posts.deletedAt)];

    if (title) {
      conditions.push(like(posts.title, `%${title}%`));
    }
    if (published_at) {
      conditions.push(eq(posts.published_at, new Date(published_at)));
    }
    if (status) {
      conditions.push(like(posts.status, `%${status}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(posts)
        .where(whereClause)
        .orderBy(desc(posts.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(posts)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Posts> {
    const rows = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Post with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreatePostDto): Promise<Posts> {
    // Check unique: title
    const existingByTitle = await this.db
      .select()
      .from(posts)
      .where(and(eq(posts.title, dto.title), isNull(posts.deletedAt)))
      .limit(1);

    if (existingByTitle.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Title '${dto.title}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(posts)
      .values({
        title: dto.title,
        content: dto.content,
        summary: dto.summary,
        cover_image: dto.cover_image,
        published_at: dto.published_at ? new Date(dto.published_at) : null,
        status: dto.status,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdatePostDto): Promise<Posts> {
    const existing = await this.findOne(id);

    if (dto.title && dto.title !== existing.title) {
      const titleConflict = await this.db
        .select()
        .from(posts)
        .where(and(eq(posts.title, dto.title), isNull(posts.deletedAt)))
        .limit(1);

      if (titleConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Title '${dto.title}' is already taken`,
        });
      }
    }

    type PostUpdateFields = {
      title?: string;
      content?: string;
      summary?: string;
      cover_image?: string;
      published_at?: Date;
      status?: string;
      updatedAt?: Date;
    };

    const updateData: PostUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.title !== undefined) updateData.title = dto.title;
    if (dto.content !== undefined) updateData.content = dto.content;
    if (dto.summary !== undefined) updateData.summary = dto.summary;
    if (dto.cover_image !== undefined) updateData.cover_image = dto.cover_image;
    if (dto.published_at !== undefined) updateData.published_at = dto.published_at ? new Date(dto.published_at) : undefined;
    if (dto.status !== undefined) updateData.status = dto.status;

    const rows = await this.db
      .update(posts)
      .set(updateData)
      .where(and(eq(posts.id, id), isNull(posts.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(posts)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(posts.id, id), isNull(posts.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(posts)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(posts.id, ids), isNull(posts.deletedAt)))
      .returning({ id: posts.id });

    return { count: rows.length };
  }

}
