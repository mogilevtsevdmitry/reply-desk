import { z } from 'zod';
import { CategorySchema, ReviewSourceSchema } from './enums';
import { GenerationDtoSchema } from './generation';

/** POST /reviews. */
export const CreateReviewDtoSchema = z.object({
  source: ReviewSourceSchema,
  rating: z.number().int().min(1).max(5).optional(),
  authorName: z.string().trim().min(1).max(100).optional(),
  rawText: z.string().trim().min(1).max(4000),
});
export type CreateReviewDto = z.infer<typeof CreateReviewDtoSchema>;

/** Ответ POST /reviews → 202. */
export const CreateReviewResponseSchema = z.object({
  reviewId: z.string(),
  generationId: z.string(),
});
export type CreateReviewResponse = z.infer<typeof CreateReviewResponseSchema>;

/** Query-параметры GET /reviews. */
export const ListReviewsQuerySchema = z.object({
  source: ReviewSourceSchema.optional(),
  category: CategorySchema.optional(),
  severity: z.coerce.number().int().min(1).max(5).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;

export const ReviewDtoSchema = z.object({
  id: z.string(),
  source: ReviewSourceSchema,
  rating: z.number().int().min(1).max(5).nullable(),
  authorName: z.string().nullable(),
  rawText: z.string(),
  category: CategorySchema.nullable(),
  severity: z.number().int().min(1).max(5).nullable(),
  isFakeSusp: z.boolean(),
  createdAt: z.string().datetime(),
});
export type ReviewDto = z.infer<typeof ReviewDtoSchema>;

/** GET /reviews/:id → Review + Generation. */
export const ReviewWithGenerationSchema = ReviewDtoSchema.extend({
  generation: GenerationDtoSchema.nullable(),
});
export type ReviewWithGeneration = z.infer<typeof ReviewWithGenerationSchema>;

/** GET /reviews → список с пагинацией. */
export const ListReviewsResponseSchema = z.object({
  items: z.array(ReviewWithGenerationSchema),
  total: z.number().int().min(0),
});
export type ListReviewsResponse = z.infer<typeof ListReviewsResponseSchema>;
