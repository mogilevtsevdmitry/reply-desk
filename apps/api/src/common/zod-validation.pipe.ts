import { Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppException } from './app.exception';

/**
 * Валидация входных DTO схемами из @replydesk/contracts.
 * Использование: @Body(new ZodValidationPipe(RegisterDtoSchema)).
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new AppException('VALIDATION_ERROR', 'Некорректные данные запроса', 422, {
        issues: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return result.data;
  }
}
