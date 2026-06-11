import { z } from 'zod';

/** Ниша компании (совпадает с Prisma enum Niche). */
export const NicheSchema = z.enum([
  'SALON',
  'DENTAL',
  'RESTO',
  'AUTO',
  'FITNESS',
  'MEDICAL',
  'HOOKAH',
  'OTHER',
]);
export type Niche = z.infer<typeof NicheSchema>;

/** Тариф (совпадает с Prisma enum Plan). */
export const PlanSchema = z.enum(['FREE', 'START', 'BUSINESS']);
export type Plan = z.infer<typeof PlanSchema>;

/** Площадка-источник отзыва (Prisma enum ReviewSource). */
export const ReviewSourceSchema = z.enum([
  'YANDEX_MAPS',
  'TWOGIS',
  'OZON',
  'WILDBERRIES',
  'OTHER',
]);
export type ReviewSource = z.infer<typeof ReviewSourceSchema>;

/** Категория проблемы (Prisma enum Category). */
export const CategorySchema = z.enum(['SERVICE', 'QUALITY', 'STAFF', 'PRICE', 'WAITING', 'OTHER']);
export type Category = z.infer<typeof CategorySchema>;

/** Статус генерации (Prisma enum GenStatus). */
export const GenStatusSchema = z.enum(['PENDING', 'ANALYZING', 'GENERATING', 'DONE', 'FAILED']);
export type GenStatus = z.infer<typeof GenStatusSchema>;
