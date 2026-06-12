import { z } from 'zod';

/** Машиночитаемые коды ошибок API. */
export const ErrorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'FORBIDDEN',
  'NOT_FOUND',
  'COMPANY_EXISTS',
  'COMPANY_NOT_FOUND',
  'CONFLICT',
  'LIMIT_EXCEEDED',
  'RATE_LIMITED',
  'BILLING_DISABLED',
  'NO_ACTIVE_SUBSCRIPTION',
  'NO_BOUND_CARD',
  'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** Единый формат ошибки API: { code, message, details? }. */
export const ErrorResponseSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
