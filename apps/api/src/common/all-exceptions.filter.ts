import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { ErrorCode, ErrorResponse } from '@replydesk/contracts';
import type { Response } from 'express';
import { AppException } from './app.exception';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  402: 'LIMIT_EXCEEDED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Единый формат ошибок API: { code, message, details? }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorResponse = {
      code: 'INTERNAL',
      message: 'Внутренняя ошибка сервера',
    };

    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = {
        code: exception.code,
        message: exception.message,
        ...(exception.details !== undefined ? { details: exception.details } : {}),
      };
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = { code: 'RATE_LIMITED', message: 'Слишком много запросов, попробуйте позже' };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      body = {
        code: STATUS_TO_CODE[status] ?? 'INTERNAL',
        message: exception.message,
      };
    } else {
      // Тексты отзывов в логи не попадают: логируем только тип/стек ошибки.
      this.logger.error(
        exception instanceof Error ? exception.stack : String(exception),
        'Unhandled exception',
      );
    }

    res.status(status).json(body);
  }
}
