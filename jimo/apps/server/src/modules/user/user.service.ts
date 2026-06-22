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

@Injectable()
export class UserService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Optional() @Inject(CASBIN_SERVICE_TOKEN) private readonly casbinService: ICasbinService | null,
    private readonly bpmSync: BpmOrgSyncService,
  ) {}

  /**
   * Two stores hold a user's role and MUST stay in sync:
   *   - sys_users.role      — single denormalized code (display column + RolesGuard)
   *   - sys_user_roles      — join table to sys_roles (Casbin policy source)
   * The "primary" role mirrored into sys_users.role is the highest-privilege one.
   */
  private static readonly ROLE_RANK: Record<string, number> = {
    super_admin: 4,
    admin: 3,
    editor: 2,
    viewer: 1,
  };

  private pickPrimaryRoleCode(codes: string[]): string {
    return (
      codes
        .filter((c) => UserService.ROLE_RANK[c] !== undefined)
        .sort((a, b) => UserService.ROLE_RANK[b]! - UserService.ROLE_RANK[a]!)[0] ?? 'viewer'
    );
  }

  /** Resolve roleIds → the highest-privilege role code among them. */
  private async primaryRoleFromIds(roleIds: string[]): Promise<string> {
    if (roleIds.length === 0) return 'viewer';
    const roles = await this.db
      .select({ code: sysRoles.code })
      .from(sysRoles)
      .where(and(inArray(sysRoles.id, roleIds), isNull(sysRoles.deletedAt)));
    return this.pickPrimaryRoleCode(roles.map((r) => r.code));
  }

  /** Resolve a single role code → its sys_roles.id (for seeding sys_user_roles). */
  private async roleIdFromCode(code: string): Promise<string | null> {
    const rows = await this.db
      .select({ id: sysRoles.id })
      .from(sysRoles)
      .where(and(eq(sysRoles.code, code), isNull(sysRoles.deletedAt)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

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
        deptId: dto.deptId,
      })
      .returning();

    const newUser = rows[0]!;

    // Seed sys_user_roles from the single role so Casbin matches sys_users.role.
    const roleCode = dto.role ?? 'viewer';
    const roleId = await this.roleIdFromCode(roleCode);
    if (roleId) {
      await this.db.insert(sysUserRoles).values({ userId: newUser.id, roleId });
      await this.casbinService?.reloadPoliciesForUser(newUser.id);
    }

    await this.bpmSync.syncUser(newUser.id);
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
      deptId?: string | null;
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
    if (dto.deptId !== undefined) updateData.deptId = dto.deptId ?? null;

    const rows = await this.db
      .update(sysUsers)
      .set(updateData)
      .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)))
      .returning();

    // Keep sys_user_roles (Casbin) and sys_users.role (display + RolesGuard) in sync.
    if (dto.roleIds !== undefined) {
      const uniqueIds = [...new Set(dto.roleIds!)];
      await this.db.transaction(async (tx) => {
        await tx.delete(sysUserRoles).where(eq(sysUserRoles.userId, id));
        if (uniqueIds.length > 0) {
          await tx
            .insert(sysUserRoles)
            .values(uniqueIds.map((roleId) => ({ userId: id, roleId })));
        }
      });
      // Mirror the highest-privilege role into sys_users.role.
      const primaryCode = await this.primaryRoleFromIds(uniqueIds);
      const reroll = await this.db
        .update(sysUsers)
        .set({ role: primaryCode, updatedAt: new Date() })
        .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)))
        .returning();
      if (reroll[0]) rows[0] = reroll[0];
      await this.casbinService?.reloadPoliciesForUser(id);
    } else if (dto.role !== undefined) {
      // role (single) changed via the main form → mirror into sys_user_roles so
      // Casbin matches sys_users.role (which updateData already set above).
      const roleId = await this.roleIdFromCode(dto.role);
      if (roleId) {
        await this.db.transaction(async (tx) => {
          await tx.delete(sysUserRoles).where(eq(sysUserRoles.userId, id));
          await tx.insert(sysUserRoles).values({ userId: id, roleId });
        });
        await this.casbinService?.reloadPoliciesForUser(id);
      }
    }

    await this.bpmSync.syncUser(id);
    const { passwordHash: _omit, ...safeUser } = rows[0]!;
    return safeUser;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);

    await this.db
      .update(sysUsers)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysUsers.id, id), isNull(sysUsers.deletedAt)));

    await this.bpmSync.deleteUser(existing.bpmUserId);
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
