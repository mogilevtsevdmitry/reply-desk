# 02 — ТЗ: Разработчик

Прочитай 00-OVERVIEW.md и возьми дизайн из docs/design/ (tokens.css → tailwind preset,
прототипы → компоненты). Все тексты интерфейса — из копидека docs/content/COPY.md
(источник истины при расхождениях с прототипами), не сочиняй свои. Стек и структура монорепо зафиксированы в OVERVIEW.

## 1. Схема данных (Prisma, PostgreSQL + pgvector)

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  companyId    String?  @unique
  company      Company? @relation(fields: [companyId], references: [id])
  refreshTokens RefreshToken[]
  createdAt    DateTime @default(now())
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  expiresAt DateTime
  revokedAt DateTime?
}

model Company {
  id          String   @id @default(cuid())
  name        String
  niche       Niche
  plan        Plan     @default(FREE)
  toneOfVoice Json     // { tone: "soft|neutral|premium", examples: string[] (до 3, по 1000 симв.) }
  reviews     Review[]
  usage       UsageCounter[]
  createdAt   DateTime @default(now())
}

enum Niche { SALON DENTAL RESTO AUTO FITNESS MEDICAL OTHER }
enum Plan  { FREE START BUSINESS }

model UsageCounter {           // лимиты генераций
  id        String  @id @default(cuid())
  companyId String
  company   Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  period    String  // "2026-06"
  used      Int     @default(0)
  @@unique([companyId, period])
}

model Review {
  id         String       @id @default(cuid())
  companyId  String
  company    Company      @relation(fields: [companyId], references: [id], onDelete: Cascade)
  source     ReviewSource
  rating     Int?         // 1..5
  authorName String?      // имя клиента, до 100 символов (ADR-024)
  rawText    String       // до 4000 символов
  category   Category?
  severity   Int?
  isFakeSusp Boolean      @default(false)
  generation Generation?
  createdAt  DateTime     @default(now())
  @@index([companyId, createdAt])
}

enum ReviewSource { YANDEX_MAPS TWOGIS OZON WILDBERRIES OTHER }
enum Category     { SERVICE QUALITY STAFF PRICE WAITING OTHER }

model Generation {
  id             String   @id @default(cuid())
  reviewId       String   @unique
  review         Review   @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  status         GenStatus @default(PENDING)
  publicReplies  Json?    // { soft, neutral, confident, platformNotes }
  internalTask   Json?    // { what, probableCause, toCheck[], assigneeRole }
  classification Json?    // { category, severity, isRepeat, similarReviewIds[], fakeSuspicion: {flag, reason} }
  winback        Json?    // { message, compensation: {type, rationale} }
  error          String?
  tokensUsed     Int?
  createdAt      DateTime @default(now())
}

enum GenStatus { PENDING ANALYZING GENERATING DONE FAILED }
```

Миграция должна включать `CREATE EXTENSION IF NOT EXISTS pg_trgm;` и GIN-индекс
`CREATE INDEX review_rawtext_trgm_idx ON "Review" USING gin ("rawText" gin_trgm_ops);`.

## 2. Контракты API (REST, префикс /api/v1)

Все DTO описать zod-схемами в `packages/contracts`, использовать и на фронте, и в Nest
(ZodValidationPipe). Ошибки — единый формат `{ code, message, details? }`.

```
POST /auth/register        { email, password } → 201 { user }
POST /auth/login           { email, password } → { accessToken } + set-cookie refresh
POST /auth/refresh         (cookie) → { accessToken }
POST /auth/logout          → 204, ревокация refresh

GET  /company/me           → Company
POST /company              { name, niche, toneOfVoice } → { company, accessToken }
                           // онбординг, один раз; возвращает НОВЫЙ access-токен с companyId
                           // (токен, выданный при регистрации, содержит companyId=null)
PATCH /company/me          { name?, toneOfVoice? } → Company

POST /reviews              { source, rating?, authorName?, rawText } → 202 { reviewId, generationId }
                           // authorName — имя клиента, опционально, trim, ≤ 100 символов (ADR-024)
                           // в ОДНОЙ транзакции: атомарное резервирование лимита (инкремент
                           // UsageCounter) + создание Review + Generation(PENDING); затем job в BullMQ
                           // 402 LIMIT_EXCEEDED если лимит периода исчерпан
POST /reviews/:id/retry    → 202 { generationId }
                           // только для Generation в статусе FAILED, иначе 409;
                           // заново резервирует лимит (402 если исчерпан), статус → PENDING, job в очередь
GET  /reviews              ?source&category&severity&from&to&page&pageSize → { items[], total }
GET  /reviews/:id          → Review + Generation
GET  /generations/:id/events   // SSE: { status } ... финальный { status: DONE, payload }
```

## 3. AI-слой

### Интерфейс провайдера

```ts
interface LlmProvider {
  generateStructured<T>(opts: {
    system: string; user: string; schema: ZodSchema<T>;
    maxTokens: number;
  }): Promise<{ data: T; tokensUsed: number }>;
}
```

Реализация: `AnthropicProvider` (модель и ключ из env). Структурированный вывод: tool use
с одной tool «emit_result», схема из zod → JSON Schema. Невалидный JSON → один повторный
запрос с текстом ошибки валидации, затем FAILED. Таймаут вызова 60с, ретрай сетевых ошибок 2 раза
с экспоненциальной паузой.

### Пайплайн воркера (BullMQ, очередь `generation`, concurrency 5)

1. status → ANALYZING (публикация в Redis pub/sub канал `gen:{id}` для SSE)
2. Поиск похожих (pg_trgm, строго параметризованный запрос):
   `SELECT id, "rawText", category, similarity("rawText", $3) AS sim FROM "Review"
   WHERE "companyId" = $1 AND id != $2 AND similarity("rawText", $3) > $4
   ORDER BY sim DESC LIMIT 5` — порог $4 из env SIMILARITY_THRESHOLD (default 0.3).
   Кандидаты передаются в промпт; финальное решение isRepeat/similarReviewIds принимает LLM
3. status → GENERATING
4. Сборка system-промпта (см. ниже), один вызов `generateStructured` с полной схемой пакета
5. Валидация ответа: similarReviewIds — только подмножество id кандидатов из шага 2
   (произвольные/чужие id отбрасываются)
6. Сохранить Generation, обновить Review.category/severity/isFakeSusp, status → DONE
   (лимит уже зарезервирован при POST /reviews — здесь НЕ инкрементировать)
7. Любая ошибка → status FAILED + error + компенсация лимита (атомарный декремент
   UsageCounter, не ниже 0)

### Сборка промпта

```
prompts/
├── base.md            # роль, формат, общие правила ответов на отзывы
├── platforms.md       # правила площадок (Яндекс: без ссылок и телефонов; WB/Ozon: лимиты длины…)
├── fake-detection.md  # признаки заказного отзыва
└── niches/
    ├── salon.md  dental.md  resto.md  auto.md  fitness.md  medical.md  other.md
```

System = base.md + niches/{niche}.md + platforms.md (секция площадки) + fake-detection.md
+ блок тона компании (tone + examples) + блок похожих отзывов (если есть).
User = текст отзыва + рейтинг + источник.
Напиши содержательные промпты на русском: в нишевых файлах — типичные жалобы ниши,
нормы ответа, чего нельзя обещать (особенно medical/dental: без медицинских гарантий
и разглашения факта лечения — клиника не подтверждает, что автор был пациентом).

## 4. Backend — модули NestJS

`AuthModule` (bcrypt cost 12, JWT guard), `CompanyModule`, `ReviewsModule`,
`GenerationModule` (producer + worker + SSE-контроллер), `LlmModule` (провайдер за DI-токеном),
`UsageModule` (модель «резервирование»: атомарный инкремент UsageCounter в transaction
при POST /reviews и /reviews/:id/retry — конкурентные запросы не пробивают лимит;
декремент-компенсация при FAILED; FREE=10, START=100, BUSINESS=1000 — значения в env). Глобально: helmet, CORS по env-whitelist, rate limit
(@nestjs/throttler: 10 req/min на /auth/*, 60 req/min на остальное), pino-логгер
(без текстов отзывов в логах — только id).

## 5. Frontend — страницы и поведение

```
/login /register          # формы, zod-валидация, ошибки под полями
/onboarding               # 3 шага, сохранение по завершении; заменить access-токен в памяти
                          # на полученный из POST /company, затем redirect в /app
/app                      # главный экран генерации
/app/history              # таблица/карточки + фильтры, пагинация
/app/reviews/[id]         # просмотр сохранённого пакета
/app/settings             # компания и тон
```

Главный экран `/app`: textarea (счётчик до 4000), селект источника, рейтинг звёздами,
необязательное поле «Имя клиента» (authorName, ADR-024),
кнопка генерации → POST /reviews → подписка на SSE → анимация пайплайна по статусам
из MOTION.md → карточки появляются по готовности payload; над карточками — блок
«Исходный отзыв» (имя клиента, бейдж площадки, оценка звёздами, дата, полный текст;
общий компонент для экрана результата и /app/reviews/[id]). SSE — fetch-based
(fetch + ReadableStream с заголовком Authorization; нативный EventSource не умеет
заголовки — не использовать, токен в query запрещён). При FAILED — понятное сообщение
и кнопка «Повторить» (POST /reviews/:id/retry). Копирование через
navigator.clipboard + тост. Остаток лимита виден всегда; при 402 — экран апгрейда (заглушка).
Состояние сервера — TanStack Query; access-токен в памяти, авто-refresh по 401 (interceptor).

## 6. Качество кода

TypeScript strict, eslint+prettier из packages/config, без any в доменном коде.
Seed-скрипт: тестовый пользователь demo@replydesk.ru / Demo12345!, компания-салон,
5 отзывов с готовыми генерациями (захардкоженные payload, без вызова LLM); минимум 3 из них —
текстово похожие жалобы, чтобы pg_trgm-повторяемость демонстрировалась на demo-данных.
`.env.example` со ВСЕМИ переменными и комментариями. README с запуском за 3 команды.
Юнит-тесты минимум: сборка промпта, проверка лимитов, маппинг ошибок LLM (остальное — на QA-агенте).
