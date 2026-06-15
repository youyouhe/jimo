import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { CASBIN_SERVICE_TOKEN, ICasbinService } from '../../modules/role/role.service';
import { ApiErrorCode } from '@lowcode/shared';

@Injectable()
export class AuthzGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CASBIN_SERVICE_TOKEN) private readonly casbinService: ICasbinService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Skip public routes (login, health, etc.)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      user?: { sub: string };
      path: string;
      method: string;
    }>();

    const userId = request.user?.sub;
    if (!userId) {
      return false;
    }

    // Use request.path (no query string) for Casbin keyMatch
    const path = request.path;
    const method = request.method.toUpperCase();

    const allowed = await this.casbinService.enforce(userId, path, method);
    if (!allowed) {
      throw new ForbiddenException({
        code: ApiErrorCode.PERMISSION_DENIED,
        message: `Access denied: ${method} ${path}`,
      });
    }

    return true;
  }
}
