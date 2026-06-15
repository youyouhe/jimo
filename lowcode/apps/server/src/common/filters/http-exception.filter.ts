import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorCode } from '@lowcode/shared';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let msg = 'Internal server error';
    let code: number = ApiErrorCode.INTERNAL_ERROR;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        msg = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        if (Array.isArray(resp['message'])) {
          msg = (resp['message'] as string[]).join('; ');
        } else if (typeof resp['message'] === 'string') {
          msg = resp['message'];
        }
      }

      switch (status) {
        case HttpStatus.UNAUTHORIZED:
          code = ApiErrorCode.UNAUTHORIZED;
          break;
        case HttpStatus.FORBIDDEN:
          code = ApiErrorCode.PERMISSION_DENIED;
          break;
        case HttpStatus.NOT_FOUND:
          code = ApiErrorCode.RESOURCE_NOT_FOUND;
          break;
        case HttpStatus.BAD_REQUEST:
        case HttpStatus.UNPROCESSABLE_ENTITY:
          code = ApiErrorCode.PARAM_ERROR;
          break;
        default:
          code = ApiErrorCode.INTERNAL_ERROR;
      }
    } else if (exception instanceof Error) {
      msg = exception.message;
    }

    console.error(`[HttpExceptionFilter] ${request.method} ${request.url} ${status}: ${msg}`);

    response.status(status).json({
      code,
      msg,
      data: null,
    });
  }
}
