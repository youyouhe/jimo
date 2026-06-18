import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysFiles, SysFile, NewSysFile } from '../../db/schema/files';
import { MinioService } from '../../core/minio/minio.service';
import { QueryFileDto } from './dto/query-file.dto';
import { UpdateFileDto } from './dto/update-file.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';
import { Readable } from 'stream';

export type SafeFile = SysFile;

@Injectable()
export class FileService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly minioService: MinioService,
  ) {}

  /**
   * Build the browser-accessible URL for an object key using the *current*
   * MINIO_PUBLIC_URL (falling back to MINIO_ENDPOINT:PORT). Centralized here
   * so stored URLs are rewritten on read — surviving host/config changes
   * without migrating historical rows.
   */
  private buildPublicUrl(key: string): string {
    const bucket = process.env['MINIO_BUCKET'] ?? 'jimo-dev';
    const publicBase = process.env['MINIO_PUBLIC_URL']?.replace(/\/$/, '')
      ?? (() => {
        const endpoint = process.env['MINIO_ENDPOINT'] ?? 'localhost';
        const port = process.env['MINIO_PORT'] ?? '9000';
        const useSSL = process.env['MINIO_USE_SSL'] === 'true';
        return `${useSSL ? 'https' : 'http'}://${endpoint}:${port}`;
      })();
    return `${publicBase}/${bucket}/${key}`;
  }

  /** Rewrite a file record's url with the current public base. */
  private withCurrentUrl<T extends SysFile>(file: T): T {
    return { ...file, url: this.buildPublicUrl(file.key) };
  }

  /**
   * Upload a file: store binary in MinIO, create DB record.
   * @param file Multer file object from FileInterceptor
   * @returns Created SysFile record
   */
  async upload(file: Express.Multer.File): Promise<SysFile> {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const dateDir = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const uuid = randomUUID();
    const objKey = `${dateDir}/${uuid}.${ext}`;

    // Determine content type
    const contentType = file.mimetype || 'application/octet-stream';

    // Upload to MinIO
    const buffer = file.buffer;
    await this.minioService.uploadFile(objKey, buffer, file.size, contentType);

    // Build the access URL via the shared helper (keeps write/read consistent).
    const url = this.buildPublicUrl(objKey);

    // Insert DB record
    const rows = await this.db
      .insert(sysFiles)
      .values({
        name: file.originalname,
        url,
        key: objKey,
        tag: ext,
        ext,
        size: file.size,
      })
      .returning();

    if (rows.length === 0) {
      throw new InternalServerErrorException({
        code: ApiErrorCode.DB_ERROR,
        message: 'Failed to create file record',
      });
    }

    return this.withCurrentUrl(rows[0]!);
  }

  /**
   * Get paginated list of files with optional keyword/tag filter.
   */
  async findAll(query: QueryFileDto): Promise<PaginatedData<SysFile>> {
    const { page, pageSize, keyword, tag } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysFiles.deletedAt)];

    if (keyword) {
      conditions.push(like(sysFiles.name, `%${keyword}%`));
    }
    if (tag) {
      conditions.push(eq(sysFiles.tag, tag));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysFiles)
        .where(whereClause)
        .limit(pageSize)
        .offset(offset)
        .orderBy(sql`${sysFiles.createdAt} DESC`),
      this.db
        .select({ count: count() })
        .from(sysFiles)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows.map((r) => this.withCurrentUrl(r)), total, page, pageSize };
  }

  /**
   * Get a single file by ID.
   */
  async findOne(id: string): Promise<SysFile> {
    const rows = await this.db
      .select()
      .from(sysFiles)
      .where(and(eq(sysFiles.id, id), isNull(sysFiles.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `File with id ${id} not found`,
      });
    }

    return this.withCurrentUrl(rows[0]!);
  }

  /**
   * Get full file info (same as findOne, separate for API semantics).
   */
  async getFileInfo(id: string): Promise<SysFile> {
    return this.findOne(id);
  }

  /**
   * Get file stream and metadata for download.
   * @returns Object with stream, contentType, and filename
   */
  async download(id: string): Promise<{
    stream: Readable;
    contentType: string;
    filename: string;
  }> {
    const file = await this.findOne(id);
    const { stream, contentType } = await this.minioService.getFileStream(file.key);

    return {
      stream,
      contentType,
      filename: file.name,
    };
  }

  /**
   * Update the display name of a file.
   */
  async updateName(id: string, dto: UpdateFileDto): Promise<SysFile> {
    await this.findOne(id); // verify exists

    if (!dto.name) {
      throw new BadRequestException({
        code: ApiErrorCode.PARAM_ERROR,
        message: 'File name is required for update',
      });
    }

    const rows = await this.db
      .update(sysFiles)
      .set({
        name: dto.name,
        updatedAt: new Date(),
      })
      .where(and(eq(sysFiles.id, id), isNull(sysFiles.deletedAt)))
      .returning();

    return rows[0]!;
  }

  /**
   * Delete a file: remove from MinIO first, then soft-delete DB record.
   */
  async remove(id: string): Promise<void> {
    const file = await this.findOne(id);

    // Delete from MinIO first
    try {
      await this.minioService.deleteFile(file.key);
    } catch (error: any) {
      // Log and continue — DB soft-delete should proceed even if MinIO delete fails
      // (orphaned objects can be cleaned up by bucket lifecycle policies)
    }

    // Soft-delete DB record
    await this.db
      .update(sysFiles)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysFiles.id, id), isNull(sysFiles.deletedAt)));
  }
}
