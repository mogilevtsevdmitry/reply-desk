import { z } from 'zod';
import { NicheSchema, PlanSchema } from './enums';

/**
 * Тон бренда компании. Хранится в JSON-колонке Company.toneOfVoice.
 * Поле avoid — «чего избегать в ответах», см. ADR-011.
 */
export const ToneOfVoiceSchema = z.object({
  tone: z.enum(['soft', 'neutral', 'premium']),
  examples: z.array(z.string().max(1000)).max(3).default([]),
  avoid: z.string().max(1000).optional(),
});
export type ToneOfVoice = z.infer<typeof ToneOfVoiceSchema>;

export const CompanyDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  niche: NicheSchema,
  plan: PlanSchema,
  toneOfVoice: ToneOfVoiceSchema,
  createdAt: z.string().datetime(),
});
export type CompanyDto = z.infer<typeof CompanyDtoSchema>;

/** Использование лимита генераций за текущий период (ADR-022). */
export const UsageDtoSchema = z.object({
  used: z.number().int().min(0),
  limit: z.number().int().min(0),
  period: z.string(), // "2026-06"
});
export type UsageDto = z.infer<typeof UsageDtoSchema>;

/**
 * Ответ GET /company/me: компания + usage текущего периода —
 * счётчик лимита в сайдбаре без отдельного эндпоинта (ADR-022).
 */
export const CompanyMeResponseSchema = CompanyDtoSchema.extend({
  usage: UsageDtoSchema,
});
export type CompanyMeResponse = z.infer<typeof CompanyMeResponseSchema>;

/** POST /company — онбординг, один раз. */
export const CreateCompanyDtoSchema = z.object({
  name: z.string().trim().min(1).max(200),
  niche: NicheSchema,
  toneOfVoice: ToneOfVoiceSchema,
});
export type CreateCompanyDto = z.infer<typeof CreateCompanyDtoSchema>;

/** Ответ POST /company: компания + НОВЫЙ access-токен с companyId (ADR-005). */
export const CreateCompanyResponseSchema = z.object({
  company: CompanyDtoSchema,
  accessToken: z.string(),
});
export type CreateCompanyResponse = z.infer<typeof CreateCompanyResponseSchema>;

/** PATCH /company/me. Ниша и тариф через этот эндпоинт не меняются. */
export const UpdateCompanyDtoSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    toneOfVoice: ToneOfVoiceSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.toneOfVoice !== undefined, {
    message: 'Нужно передать хотя бы одно поле',
  });
export type UpdateCompanyDto = z.infer<typeof UpdateCompanyDtoSchema>;
