import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { UserService, SafeUser } from '../../modules/user/user.service';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysJwtBlacklist } from '../../db/schema/jwt-blacklist';
import { ApiErrorCode } from '@jimo/shared';
import { TokenResponseDto } from './dto/token-response.dto';

export type { SafeUser };

export interface JwtPayload {
  sub: string;
  username: string;
  /** All role codes the user holds (from sys_user_roles). */
  roles: string[];
  jti: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async validateUser(username: string, password: string): Promise<SafeUser> {
    const user = await this.userService.findByUsername(username);
    if (!user) {
      throw new UnauthorizedException({
        code: ApiErrorCode.UNAUTHORIZED,
        message: 'Invalid username or password',
      });
    }

    if (user.status === 2) {
      throw new UnauthorizedException({
        code: ApiErrorCode.USER_DISABLED,
        message: 'User account is disabled',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException({
        code: ApiErrorCode.PASSWORD_WRONG,
        message: 'Invalid username or password',
      });
    }

    const { passwordHash: _omit, ...safeUser } = user;
    return safeUser;
  }

  async login(user: SafeUser): Promise<TokenResponseDto> {
    const jti = randomUUID();
    const refreshJti = randomUUID();

    // Roles come from sys_user_roles (single source of truth). Fetched here so
    // both login and refresh (which re-reads the user) always carry fresh roles.
    const roles = await this.userService.getRoleCodes(user.id);

    const payload: JwtPayload = {
      sub: user.id,
      username: user.username,
      roles,
      jti,
    };

    const refreshPayload: JwtPayload = {
      sub: user.id,
      username: user.username,
      roles,
      jti: refreshJti,
    };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env['JWT_SECRET'],
      expiresIn: '2h',
    });

    const refreshToken = this.jwtService.sign(refreshPayload, {
      secret: process.env['JWT_REFRESH_SECRET'] ?? process.env['JWT_SECRET'],
      expiresIn: '7d',
    });

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 7200,
    };
  }

  async refreshToken(refreshTokenStr: string): Promise<TokenResponseDto> {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshTokenStr, {
        secret: process.env['JWT_REFRESH_SECRET'] ?? process.env['JWT_SECRET'],
      });
    } catch {
      throw new UnauthorizedException({
        code: ApiErrorCode.TOKEN_INVALID,
        message: 'Invalid or expired refresh token',
      });
    }

    const isBlacklisted = await this.isJtiBlacklisted(payload.jti);
    if (isBlacklisted) {
      throw new UnauthorizedException({
        code: ApiErrorCode.TOKEN_INVALID,
        message: 'Refresh token has been revoked',
      });
    }

    // Blacklist old refresh token jti
    await this.blacklistJti(payload.jti, 7);

    const user = await this.userService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException({
        code: ApiErrorCode.UNAUTHORIZED,
        message: 'User not found',
      });
    }

    const { passwordHash: _omit, ...safeUser } = user;
    return this.login(safeUser);
  }

  async logout(accessJti: string, refreshToken?: string): Promise<void> {
    await this.blacklistJti(accessJti, 2);

    if (refreshToken) {
      try {
        const payload = this.jwtService.verify<JwtPayload>(refreshToken, {
          secret: process.env['JWT_REFRESH_SECRET'] ?? process.env['JWT_SECRET'],
        });
        await this.blacklistJti(payload.jti, 7);
      } catch {
        // Refresh token invalid/expired — already harmless, skip
      }
    }
  }

  async isJtiBlacklisted(jti: string): Promise<boolean> {
    const rows = await this.db
      .select()
      .from(sysJwtBlacklist)
      .where(eq(sysJwtBlacklist.jti, jti))
      .limit(1);
    return rows.length > 0;
  }

  private async blacklistJti(jti: string, daysUntilExpiry: number): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysUntilExpiry);

    await this.db.insert(sysJwtBlacklist).values({
      jti,
      expiresAt,
    }).onConflictDoNothing();
  }
}
