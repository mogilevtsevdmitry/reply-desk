import { z } from 'zod';
import { CategorySchema, GenStatusSchema } from './enums';

/** Блок 1 — публичный ответ в трёх тонах + правила площадки. */
export const PublicRepliesSchema = z.object({
  soft: z.string(),
  neutral: z.string(),
  confident: z.string(),
  platformNotes: z.string(),
});
export type PublicReplies = z.infer<typeof PublicRepliesSchema>;

/** Блок 2 — внутренняя задача. assigneeRole — свободный текст (ADR-013). */
export const InternalTaskSchema = z.object({
  what: z.string(),
  probableCause: z.string(),
  toCheck: z.array(z.string()),
  assigneeRole: z.string(),
});
export type InternalTask = z.infer<typeof InternalTaskSchema>;

/** Блок 3 — классификация. */
export const ClassificationSchema = z.object({
  category: CategorySchema,
  severity: z.number().int().min(1).max(5),
  isRepeat: z.boolean(),
  similarReviewIds: z.array(z.string()),
  fakeSuspicion: z.object({
    flag: z.boolean(),
    reason: z.string(),
  }),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/** Блок 4 — возврат клиента. */
export const WinbackSchema = z.object({
  message: z.string(),
  compensation: z.object({
    type: z.string(),
    rationale: z.string(),
  }),
});
export type Winback = z.infer<typeof WinbackSchema>;

/** Полный пакет генерации (4 блока) — schema для structured output LLM. */
export const GenerationPayloadSchema = z.object({
  publicReplies: PublicRepliesSchema,
  internalTask: InternalTaskSchema,
  classification: ClassificationSchema,
  winback: WinbackSchema,
});
export type GenerationPayload = z.infer<typeof GenerationPayloadSchema>;

export const GenerationDtoSchema = z.object({
  id: z.string(),
  reviewId: z.string(),
  status: GenStatusSchema,
  publicReplies: PublicRepliesSchema.nullable(),
  internalTask: InternalTaskSchema.nullable(),
  classification: ClassificationSchema.nullable(),
  winback: WinbackSchema.nullable(),
  error: z.string().nullable(),
  tokensUsed: z.number().int().nullable(),
  createdAt: z.string().datetime(),
});
export type GenerationDto = z.infer<typeof GenerationDtoSchema>;

/** Событие SSE GET /generations/:id/events. payload — только в финальном DONE. */
export const GenerationEventSchema = z.object({
  status: GenStatusSchema,
  payload: GenerationPayloadSchema.optional(),
  error: z.string().optional(),
});
export type GenerationEvent = z.infer<typeof GenerationEventSchema>;
