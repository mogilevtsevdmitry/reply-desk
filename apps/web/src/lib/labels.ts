import type { Category, Niche, ReviewSource } from '@replydesk/contracts';

/** Подписи enum-значений — строго из COPY.md (включая добавленные ADR-009). */

export const nicheLabels: Record<Niche, string> = {
  SALON: 'Салон красоты',
  DENTAL: 'Стоматология',
  RESTO: 'Ресторан',
  AUTO: 'Автосервис',
  FITNESS: 'Фитнес',
  MEDICAL: 'Медицинская клиника',
  OTHER: 'Другое',
};

export const sourceLabels: Record<ReviewSource, string> = {
  YANDEX_MAPS: 'Яндекс.Карты',
  TWOGIS: '2ГИС',
  OZON: 'Ozon',
  WILDBERRIES: 'Wildberries',
  OTHER: 'Другая площадка',
};

/** card-reply-note-*: пометка площадки в карточке публичного ответа. */
export const sourceReplyNotes: Record<ReviewSource, string> = {
  YANDEX_MAPS: 'адаптировано под Яндекс.Карты',
  TWOGIS: 'адаптировано под 2ГИС',
  OZON: 'адаптировано под Ozon',
  WILDBERRIES: 'адаптировано под Wildberries',
  OTHER: 'без привязки к площадке',
};

export const categoryLabels: Record<Category, string> = {
  SERVICE: 'Сервис',
  QUALITY: 'Качество',
  STAFF: 'Персонал',
  PRICE: 'Цена',
  WAITING: 'Ожидание',
  OTHER: 'Другое',
};

/** Tailwind-классы цвета точки площадки (токены темы --color-src-*). */
export const sourceDotClass: Record<ReviewSource, string> = {
  YANDEX_MAPS: 'bg-src-yandex',
  TWOGIS: 'bg-src-2gis',
  OZON: 'bg-src-ozon',
  WILDBERRIES: 'bg-src-wb',
  OTHER: 'bg-ink-faint',
};
