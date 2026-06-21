import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyBpmSignature } from './hmac.util';

/** Reject callbacks whose timestamp drifts more than this from server time. */
const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Authenticates inbound BPM callbacks via an HMAC-SHA256 signature over the
 * raw request body. Applied on top of `@Public()` routes (which bypass the
 * global JWT/Roles/Authz guards).
 *
 * Requires `rawBody: true` on the NestFactory (see main.ts).
 */
@Injectable()
export class BpmSignatureGuard implements CanActivate {
  private readonly logger = new Logger(BpmSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      rawBody?: Buffer;
      headers: Record<string, string | string[] | undefined>;
    }>();

    const secret = this.config.get<string>('BPM_CALLBACK_SECRET');
    if (!secret) {
      this.logger.error('BPM_CALLBACK_SECRET is not configured');
      throw new UnauthorizedException('Callback secret not configured');
    }

    const sig = req.headers['x-bpm-signature'];
    const ts = req.headers['x-bpm-timestamp'];
    if (typeof sig !== 'string' || typeof ts !== 'string' || !sig || !ts) {
      throw new UnauthorizedException('Missing BPM signature headers');
    }

    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) {
      throw new UnauthorizedException('Invalid BPM timestamp');
    }
    if (Math.abs(Date.now() - tsNum) > MAX_SKEW_MS) {
      throw new UnauthorizedException('BPM timestamp outside allowed window');
    }

    if (!req.rawBody) {
      throw new UnauthorizedException('Raw body unavailable for signature verification');
    }

    if (!verifyBpmSignature(secret, ts, req.rawBody, sig)) {
      throw new UnauthorizedException('Invalid BPM signature');
    }
    return true;
  }
}
