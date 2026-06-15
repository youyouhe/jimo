import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../../core/auth/auth.service';
import { ApiErrorCode } from '@lowcode/shared';
import { CASBIN_SERVICE_TOKEN, ICasbinService } from '../../modules/role/role.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CASBIN_SERVICE_TOKEN) private readonly casbinService: ICasbinService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
    const user = request.user;

    if (!user?.sub) {
      throw new ForbiddenException({
        code: ApiErrorCode.PERMISSION_DENIED,
        message: 'Insufficient permissions',
      });
    }

    for (const roleCode of required) {
      const hasRole = await this.casbinService.hasRoleForUser(user.sub, roleCode);
      if (hasRole) return true;
    }

    throw new ForbiddenException({
      code: ApiErrorCode.PERMISSION_DENIED,
      message: 'Insufficient permissions',
    });
  }
}
