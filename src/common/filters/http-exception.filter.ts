import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Normalizes every thrown error to { statusCode, message, error } so the
 * frontend's existing `toast.error(...)` call sites need only read
 * `body.message` instead of a Firebase-SDK-shaped error object.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = isHttpException ? exception.getResponse() : null;
    const message =
      (typeof body === 'object' && body && 'message' in body
        ? (body as { message: string | string[] }).message
        : isHttpException
          ? exception.message
          : 'Internal server error') ?? 'Internal server error';

    response.status(statusCode).json({
      statusCode,
      message,
      error: isHttpException ? exception.name : 'InternalServerError',
    });
  }
}
