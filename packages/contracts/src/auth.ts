import { z } from 'zod';

/** Email + пароль. Пароль 8–72 символа (72 — предел bcrypt), см. ADR-018. */
export const CredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),
});

/**
 * Регистрация: помимо учётных данных — два РАЗДЕЛЬНЫХ обязательных согласия
 * (юридическое требование, 152-ФЗ): acceptTerms — соглашение + политика +
 * согласие на обработку ПД; acceptLlm — отдельное согласие на трансграничную
 * передачу данных поставщику LLM (Anthropic, США). false/отсутствие → 422.
 */
export const RegisterDtoSchema = CredentialsSchema.extend({
  acceptTerms: z.literal(true),
  acceptLlm: z.literal(true),
});
export type RegisterDto = z.infer<typeof RegisterDtoSchema>;

export const LoginDtoSchema = CredentialsSchema;
export type LoginDto = z.infer<typeof LoginDtoSchema>;

export const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  companyId: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

/** Ответ POST /auth/register → 201. */
export const RegisterResponseSchema = z.object({ user: UserDtoSchema });
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

/** Ответ POST /auth/login и POST /auth/refresh (refresh-кука ставится отдельно). */
export const AuthTokenResponseSchema = z.object({ accessToken: z.string() });
export type AuthTokenResponse = z.infer<typeof AuthTokenResponseSchema>;

/** Полезная нагрузка access-JWT. companyId = null до онбординга (ADR-005). */
export const AccessTokenPayloadSchema = z.object({
  sub: z.string(),
  companyId: z.string().nullable(),
});
export type AccessTokenPayload = z.infer<typeof AccessTokenPayloadSchema>;
