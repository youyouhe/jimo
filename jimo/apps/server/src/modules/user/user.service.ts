import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysUsers, SysUser } from '../../db/schema/users';
import { sysUserRoles } from '../../db/schema/user-roles';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';
import { CASBIN_SERVICE_TOKEN, ICasbinService } from '../role/role.service';

export type SafeUser = Omit<SysUser, 'passwordHash'>;

@Injectable()
export class UserService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Optional() @Inject(CASBIN_SERVICE_TOKEN) private readonly casbinService: ICasbinService | null,
  ) {}

  async findAll(query: QueryUserDto): Promise<PaginatedData<SafeUser>> {
    const { page, pageSize, username, nickname, phone, email, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysUsers.deletedAt)];

    if (username) {
      conditions.push(like(sysUsers.username, `%${username}%`));
    }
    if (nickname) {
      conditions.push(like(sysUsers.nickname, `%${nickname}%`));
    }
    if (phone) {
      conditions.push(like(sysUsers.phone, `%${phone}%`));
    }
    if (email) {
      conditions.push(like(sysUsers.email, `%${email}%`));
    }
    if (status !== undefined) {
      conditions.push(eq(sysUsers.status, status));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysUsers)
        .where(whereClause)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysUsers)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;
    const list = rows.map(({ passwordHash: _omit, ...user }) => user);

    return { list, total, page, pageSize };
  }

  async findOne(id: string): Promise<SafeUser> {
    const rows = await this.db
      .select()
      .from(sysUsers)
      .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `User with id ${id} not found`,
      });
    }

    const { passwordHash: _omit, ...user } = rows[0]!;
    return user;
  }

  async findById(id: string): Promise<SysUser | null> {
    const rows = await this.db
      .select()
      .from(sysUsers)
      .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async findByUsername(username: string): Promise<SysUser | null> {
    const rows = await this.db
      .select()
      .from(sysUsers)
      .where(and(eq(sysUsers.username, username), isNull(sysUsers.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async create(dto: CreateUserDto): Promise<SafeUser> {
    const existing = await this.findByUsername(dto.username);
    if (existing) {
      throw new ConflictException({
        code: ApiErrorCode.USERNAME_EXISTS,
        message: `Username '${dto.username}' is already taken`,
      });
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const rows = await this.db
      .insert(sysUsers)
      .values({
        username: dto.username,
        passwordHash,
        nickname: dto.nickname ?? '',
        email: dto.email,
        phone: dto.phone,
        role: dto.role ?? 'viewer',
        status: dto.status !== undefined ? (dto.status as 1 | 2) : 1,
      })
      .returning();

    const newUser = rows[0]!;
    const { passwordHash: _omit, ...safeUser } = newUser;
    return safeUser;
  }

  async update(id: string, dto: UpdateUserDto): Promise<SafeUser> {
    await this.findOne(id);

    type UserUpdateFields = {
      nickname?: string;
      email?: string | null;
      phone?: string | null;
      role?: string;
      status?: 1 | 2;
      updatedAt?: Date;
    };

    const updateData: UserUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.nickname !== undefined) updateData.nickname = dto.nickname;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.status !== undefined) updateData.status = dto.status as 1 | 2;

    const rows = await this.db
      .update(sysUsers)
      .set(updateData)
      .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)))
      .returning();

    // Handle multi-role assignment via sys_user_roles
    if (dto.roleIds !== undefined) {
      await this.db.transaction(async (tx) => {
        await tx.delete(sysUserRoles).where(eq(sysUserRoles.userId, id));
        if (dto.roleIds!.length > 0) {
          const uniqueIds = [...new Set(dto.roleIds!)];
          await tx
            .insert(sysUserRoles)
            .values(uniqueIds.map((roleId) => ({ userId: id, roleId })));
        }
      });
      // Reload Casbin policies for this user
      if (this.casbinService) {
        await this.casbinService.reloadPoliciesForUser(id);
      }
    }

    const { passwordHash: _omit, ...safeUser } = rows[0]!;
    return safeUser;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .update(sysUsers)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)));
  }

  async getProfile(userId: string): Promise<SafeUser> {
    const rows = await this.db
      .select()
      .from(sysUsers)
      .where(and(eq(sysUsers.id, userId), isNull(sysUsers.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: 'User not found',
      });
    }

    const { passwordHash: _omit, ...safeUser } = rows[0]!;
    return safeUser;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<SafeUser> {
    await this.getProfile(userId);

    type ProfileUpdateFields = {
      nickname?: string;
      email?: string | null;
      phone?: string | null;
      avatar?: string | null;
      updatedAt?: Date;
    };

    const updateData: ProfileUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.nickname !== undefined) updateData.nickname = dto.nickname;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.avatar !== undefined) updateData.avatar = dto.avatar;

    const rows = await this.db
      .update(sysUsers)
      .set(updateData)
      .where(and(eq(sysUsers.id, userId), isNull(sysUsers.deletedAt)))
      .returning();

    const { passwordHash: _omit, ...safeUser } = rows[0]!;
    return safeUser;
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const rows = await this.db
      .select()
      .from(sysUsers)
      .where(and(eq(sysUsers.id, userId), isNull(sysUsers.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: 'User not found',
      });
    }

    const user = rows[0]!;
    const isOldPasswordValid = await bcrypt.compare(
      dto.oldPassword,
      user.passwordHash,
    );

    if (!isOldPasswordValid) {
      throw new BadRequestException({
        code: ApiErrorCode.PASSWORD_WRONG,
        message: 'Old password is incorrect',
      });
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, 12);

    await this.db
      .update(sysUsers)
      .set({ passwordHash: newPasswordHash, updatedAt: new Date() })
      .where(and(eq(sysUsers.id, userId), isNull(sysUsers.deletedAt)));
  }
}
