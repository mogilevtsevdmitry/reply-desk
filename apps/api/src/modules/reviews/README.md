# ReviewsModule — заглушка-граница

Реализуется в задаче 2.2 (генерационный конвейер):

- `POST /reviews` — в ОДНОЙ транзакции `UsageService.reserve()` + создание
  Review + Generation(PENDING), затем job в BullMQ (ADR-002);
- `POST /reviews/:id/retry` — только из FAILED, повторное резервирование (ADR-003);
- `GET /reviews`, `GET /reviews/:id` — фильтры/пагинация, строго по companyId из JWT.

Контракты DTO уже готовы в `@replydesk/contracts` (reviews.ts).
Резервирование/компенсация лимитов готовы в `UsageService` (usage/usage.service.ts).
