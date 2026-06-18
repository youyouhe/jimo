import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { OperationRecordService } from '../../modules/operation-record/operation-record.service';
import type { NewSysOperationRecord } from '../../db/schema/operation-records';

const MAX_BODY_LENGTH = 1024;
const SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'secret',
  'accessToken',
  'refreshToken',
  'secretKey',
  'minio.secretKey',
];

/**
 * Redact sensitive field values from a JSON string.
 */
function sanitizeJson(json: string): string {
  let result = json;
  for (const field of SENSITIVE_FIELDS) {
    const regex = new RegExp(`"${field}"\\s*:\\s*"([^"]*)"`, 'gi');
    result = result.replace(regex, `"${field}":"[REDACTED]"`);
  }
  return result;
}

/**
 * Capture and truncate a string to MAX_BODY_LENGTH characters.
 */
function truncate(value: string): string {
  if (value.length <= MAX_BODY_LENGTH) {
    return value;
  }
  return value.substring(0, MAX_BODY_LENGTH);
}

/**
 * Capture the request body for audit logging:
 * - GET: capture req.query as JSON
 * - multipart/form-data: '[FILE]'
 * - Otherwise: JSON.stringify(req.body), truncated to MAX_BODY_LENGTH
 */
function captureRequestBody(req: Request): string {
  if (req.method === 'GET') {
    const q = req.query;
    if (q && Object.keys(q).length > 0) {
      return truncate(sanitizeJson(JSON.stringify(q)));
    }
    return '';
  }

  const contentType = req.headers['content-type'] ?? '';
  if (contentType.startsWith('multipart/form-data')) {
    return '[FILE]';
  }

  if (req.body === undefined || req.body === null) {
    return '';
  }

  try {
    const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    return truncate(sanitizeJson(bodyStr));
  } catch {
    return '';
  }
}

/**
 * Capture the response body for audit logging:
 * - Binary/non-JSON responses: '[BINARY]'
 * - JSON responses: stringified and truncated to MAX_BODY_LENGTH
 */
function captureResponseBody(data: unknown, res: Response): string {
  const contentType = res.getHeader('content-type');
  const ct = typeof contentType === 'string' ? contentType : String(contentType ?? '');

  // Skip body capture for binary or non-JSON responses
  if (ct && !ct.includes('json') && !ct.includes('text') && !ct.includes('html')) {
    return '[BINARY]';
  }

  if (data === undefined || data === null) {
    return '';
  }

  try {
    const respStr = typeof data === 'string' ? data : JSON.stringify(data);
    return truncate(sanitizeJson(respStr));
  } catch {
    return '';
  }
}

/**
 * Extract the client IP address from the request.
 */
function captureIp(req: Request): string {
  if (typeof req.ip === 'string' && req.ip) {
    return req.ip;
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0]!.trim();
  }
  if (req.socket?.remoteAddress) {
    return req.socket.remoteAddress;
  }
  return 'unknown';
}

/**
 * Extract an error message from an exception object.
 */
function captureErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj['message'] === 'string') {
      return obj['message'];
    }
    try {
      return JSON.stringify(err);
    } catch {
      return 'Unknown error';
    }
  }
  return 'Unknown error';
}

/**
 * Extract HTTP status code from an exception object.
 */
function captureErrorStatus(err: unknown, res: Response): number {
  // Use the status code that NestJS set on the response for the error
  if (res.statusCode && res.statusCode >= 400) {
    return res.statusCode;
  }
  // Fallback: try getStatus() for HttpException
  if (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as Record<string, unknown>)['getStatus'] === 'function'
  ) {
    return (err as { getStatus: () => number }).getStatus();
  }
  return 500;
}

@Injectable()
export class OperationInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OperationInterceptor.name);

  constructor(
    private readonly operationRecordService: OperationRecordService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = Date.now();

    // 1. Capture request metadata
    const ip = captureIp(req);
    const method = req.method;
    const path = req.url;
    const agent = (req.headers['user-agent'] as string) ?? '';

    // 2. Capture user from JWT payload (Passport sets req.user = JwtPayload)
    const user = (req as unknown as { user?: { sub?: string } }).user;
    const userId = user?.sub ?? null;

    // 3. Capture request body (sanitized, truncated)
    const body = captureRequestBody(req);

    // Log incoming request (skip GET to reduce noise, always log mutations)
    if (method !== 'GET') {
      this.logger.log(`→ ${method} ${path} user=${userId ?? 'anon'} body=${body || '(empty)'}`);
    } else {
      this.logger.verbose(`→ GET ${path} user=${userId ?? 'anon'} query=${body || '(empty)'}`);
    }

    return next.handle().pipe(
      tap({
        next: (data: unknown) => {
          try {
            const latency = Date.now() - start;
            const status = res.statusCode;
            const resp = captureResponseBody(data, res);

            this.logger.log(`← ${method} ${path} ${status} ${latency}ms`);

            const record: NewSysOperationRecord = {
              ip,
              method,
              path,
              status,
              latency,
              agent,
              body,
              resp,
              userId: userId as string | null,
              errorMessage: null,
            };

            this.operationRecordService.createAsync(record);
          } catch (err: unknown) {
            this.logger.error('Failed to capture audit record (success path)', err);
          }
        },
        error: (err: unknown) => {
          try {
            const latency = Date.now() - start;
            const status = captureErrorStatus(err, res);
            const errorMessage = truncate(captureErrorMessage(err));

            this.logger.error(`✗ ${method} ${path} ${status} ${latency}ms — ${errorMessage}`);

            const record: NewSysOperationRecord = {
              ip,
              method,
              path,
              status,
              latency,
              agent,
              body,
              resp: '',
              userId: userId as string | null,
              errorMessage,
            };

            this.operationRecordService.createAsync(record);
          } catch (innerErr: unknown) {
            this.logger.error('Failed to capture audit record (error path)', innerErr);
          }
        },
      }),
    );
  }
}
