import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysUsers, SysUser } from '../../db/schema/users';
import { sysUserRoles } from '../../db/schema/user-roles';
import { sysRoles } from '../../db/schema/roles';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';
import { CASBIN_SERVICE_TOKEN, ICasbinService } from '../role/role.service';
import { BpmOrgSyncService } from '../bpm-sync/bpm-org-sync.service';

export type SafeUser = Omit<SysUser, 'passwordHash'>;

/** A user with its role codes resolved from sys_user_roles (single source of truth). */
export type UserWithRoles = SafeUser & { roles: string[] };

@Injectable()
export class UserService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Optional() @Inject(CASBIN_SERVICE_TOKEN) private readonly casbinService: ICasbinService | null,
    private readonly bpmSync: BpmOrgSyncService,
  ) {}

  /** Role codes a user holds (from sys_user_roles → sys_roles.code). */
  async getRoleCodes(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ code: sysRoles.code })
      .from(sysUserRoles)
      .innerJoin(sysRoles, eq(sysRoles.id, sysUserRoles.roleId))
      .where(and(eq(sysUserRoles.userId, userId), isNull(sysRoles.deletedAt)));
    return rows.map((r) => r.code);
  }

  /** Batched role lookup for a page of users (one query, grouped in memory). */
  private async rolesByUser(userIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (userIds.length === 0) return map;
    const rows = await this.db
      .select({ userId: sysUserRoles.userId, code: sysRoles.code })
      .from(sysUserRoles)
      .innerJoin(sysRoles, eq(sysRoles.id, sysUserRoles.roleId))
      .where(and(inArray(sysUserRoles.userId, userIds), isNull(sysRoles.deletedAt)));
    for (const r of rows) {
      const arr = map.get(r.userId) ?? [];
      arr.push(r.code);
      map.set(r.userId, arr);
    }
    return map;
  }

  /** Resolve a role code → its sys_roles.id (for defaulting new users to viewer). */
  private async roleIdFromCode(code: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: sysRoles.id })
      .from(sysRoles)
      .where(and(eq(sysRoles.code, code), isNull(sysRoles.deletedAt)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  /** Full-replace a user's sys_user_roles rows. */
  private async setRoleIds(userId: string, roleIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(roleIds)];
    await this.db.transaction(async (tx) => {
      await tx.delete(sysUserRoles).where(eq(sysUserRoles.userId, userId));
      if (uniqueIds.length > 0) {
        await tx
          .insert(sysUserRoles)
          .values(uniqueIds.map((roleId) => ({ userId, roleId })));
      }
    });
    await this.casbinService?.reloadPoliciesForUser(userId);
  }

  async findAll(query: QueryUserDto): Promise<PaginatedData<UserWithRoles>> {
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
    const rolesMap = await this.rolesByUser(rows.map((r) => r.id));
    const list: UserWithRoles[] = rows.map(({ passwordHash: _omit, ...user }) => ({
      ...user,
      roles: rolesMap.get(user.id) ?? [],
    }));

    return { list, total, page, pageSize };
  }

  async findOne(id: string): Promise<UserWithRoles> {
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
    return { ...user, roles: await this.getRoleCodes(user.id) };
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

  async create(dto: CreateUserDto): Promise<UserWithRoles> {
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
        status: dto.status !== undefined ? (dto.status as 1 | 2) : 1,
        deptId: dto.deptId,
      })
      .returning();

    const newUser = rows[0]!;

    // Assign roles. Default to viewer when none provided so the user can log in.
    let roleIds = dto.roleIds ?? [];
    if (roleIds.length === 0) {
      const viewerId = await this.roleIdFromCode('viewer');
      if (viewerId) roleIds = [viewerId];
    }
    if (roleIds.length > 0) {
      await this.setRoleIds(newUser.id, roleIds);
    }

    await this.bpmSync.syncUser(newUser.id);
    const { passwordHash: _omit, ...safeUser } = newUser;
    return { ...safeUser, roles: await this.getRoleCodes(newUser.id) };
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserWithRoles> {
    await this.findOne(id);

    type UserUpdateFields = {
      nickname?: string;
      email?: string | null;
      phone?: string | null;
      status?: 1 | 2;
      deptId?: string | null;
      updatedAt?: Date;
    };

    const updateData: UserUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.nickname !== undefined) updateData.nickname = dto.nickname;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.status !== undefined) updateData.status = dto.status as 1 | 2;
    if (dto.deptId !== undefined) updateData.deptId = dto.deptId ?? null;

    const rows = await this.db
      .update(sysUsers)
      .set(updateData)
      .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)))
      .returning();

    // Full-replace role assignment (sys_user_roles is the single source of truth).
    if (dto.roleIds !== undefined) {
      await this.setRoleIds(id, dto.roleIds);
    }

    await this.bpmSync.syncUser(id);
    const { passwordHash: _omit, ...safeUser } = rows[0]!;
    return { ...safeUser, roles: await this.getRoleCodes(id) };
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);

    await this.db
      .update(sysUsers)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)));

    await this.bpmSync.deleteUser(existing.bpmUserId);
  }

  async getProfile(userId: string): Promise<UserWithRoles> {
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
    return { ...safeUser, roles: await this.getRoleCodes(userId) };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<UserWithRoles> {
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
    return { ...safeUser, roles: await this.getRoleCodes(userId) };
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
