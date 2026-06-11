import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@replydesk/contracts';

/**
 * Доменное исключение с машиночитаемым кодом.
 * Exception-фильтр сериализует его в единый формат { code, message, details? }.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: number,
    readonly details?: unknown,
  ) {
    super(message, status);
  }
}
