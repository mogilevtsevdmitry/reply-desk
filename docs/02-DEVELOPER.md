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
  // Фиксация согласий при регистрации (152-ФЗ, ADR-033); null — старые пользователи
  consentPdAt        DateTime? // согласие на обработку ПД (+ соглашение и политика)
  consentLlmAt       DateTime? // отдельное согласие на передачу данных в LLM (Anthropic, США)
  consentDocsVersion String?   // версия редакции документов, напр. "v1.0"
}

model RefreshToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  expiresAt DateTime
  revokedAt DateTime?
}

// Токен сброса пароля (ADR-043): в письмо уходит opaque-токен,
// в БД — sha256-хэш (по образцу ADR-016). TTL 1 час, одноразовый.
model PasswordResetToken {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String   @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())
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

enum Niche { SALON DENTAL RESTO AUTO FITNESS MEDICAL HOOKAH OTHER }
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
POST /auth/register        { email, password, acceptTerms: true, acceptLlm: true } → 201 { user }
                           // два РАЗДЕЛЬНЫХ обязательных согласия (ADR-033): literal(true),
                           // отсутствие/false → 422; факт и версия фиксируются в User.consent*
POST /auth/login           { email, password } → { accessToken } + set-cookie refresh
POST /auth/refresh         (cookie) → { accessToken }
POST /auth/logout          → 204, ревокация refresh
POST /auth/forgot-password { email } → ВСЕГДА 204 (ADR-043): существование аккаунта не
                           // раскрывается ни ответом, ни таймингом; письмо со ссылкой
                           // {APP_URL}/reset-password?token=... уходит только реальному
                           // пользователю; rate limit 3 req/час по IP
POST /auth/reset-password  { token, password } → 204: смена пароля (bcrypt 12), токен
                           // одноразово гасится, ВСЕ refresh-токены ревокуются;
                           // нет/использован/истёк → 422 INVALID_TOKEN (одно сообщение)

GET  /company/me           → Company
POST /company              { name, niche, toneOfVoice } → { company, accessToken }
                           // онбординг, один раз; возвращает НОВЫЙ access-токен с companyId
                           // (токен, выданный при регистрации, содержит companyId=null)
PATCH /company/me          { name?, niche?, toneOfVoice? } → Company
                           // ниша редактируема (ADR-032): влияет на промпт следующих генераций

POST /reviews              { source, rating?, authorName?, rawText } → 202 { reviewId, generationId }
                           // authorName — имя клиента, опционально, trim, ≤ 100 символов (ADR-024)
                           // в ОДНОЙ транзакции: атомарное резервирование лимита (инкремент
                           // UsageCounter) + создание Review + Generation(PENDING); затем job в BullMQ
                           // 402 LIMIT_EXCEEDED если лимит периода исчерпан
                           // ретрай-эндпоинта нет (ADR-042): повтор после FAILED — обычный POST /reviews
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
   `SELECT id, "rawText", category, similarity("rawText", $3) AS sim FROM "Review" r
   WHERE "companyId" = $1 AND id != $2 AND similarity("rawText", $3) > $4
   AND EXISTS (SELECT 1 FROM "Generation" g WHERE g."reviewId" = r.id AND g.status = 'DONE')
   ORDER BY sim DESC LIMIT 5` — порог $4 из env SIMILARITY_THRESHOLD (default 0.3);
   кандидаты — только отзывы с успешной генерацией (ADR-042, страховка от строк в полёте).
   Кандидаты передаются в промпт; финальное решение isRepeat/similarReviewIds принимает LLM
3. status → GENERATING
4. Сборка system-промпта (см. ниже), один вызов `generateStructured` с полной схемой пакета
5. Валидация ответа: similarReviewIds — только подмножество id кандидатов из шага 2
   (произвольные/чужие id отбрасываются)
6. Сохранить Generation, обновить Review.category/severity/isFakeSusp, status → DONE
   (лимит уже зарезервирован при POST /reviews — здесь НЕ инкрементировать)
7. Любая ошибка (ADR-042, строго по порядку): компенсация лимита в источник из job
   (атомарный декремент, не ниже 0) → публикация финального SSE-события
   { status: FAILED, error } в gen:{id} → удаление Review (cascade удаляет Generation).
   FAILED-строки в БД не сохраняются: история и trgm-кандидаты не загрязняются

### Сборка промпта

```
prompts/
├── base.md            # роль, формат, общие правила ответов на отзывы
├── platforms.md       # правила площадок (Яндекс: без ссылок и телефонов; WB/Ozon: лимиты длины…)
├── fake-detection.md  # признаки заказного отзыва
└── niches/
    ├── salon.md  dental.md  resto.md  auto.md  fitness.md  medical.md  hookah.md  other.md
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
`MailModule` (nodemailer; без SMTP_HOST — dev-режим log: письмо в pino-лог с пометкой [mail:dev], ADR-044), `UsageModule` (модель «резервирование»: атомарный инкремент UsageCounter в transaction
при POST /reviews — конкурентные запросы не пробивают лимит;
декремент-компенсация при FAILED; FREE=10, START=100, BUSINESS=1000 — значения в env). Глобально: helmet, CORS по env-whitelist, rate limit
(@nestjs/throttler: 10 req/min на /auth/*, 3 req/час на /auth/forgot-password, 60 req/min на остальное), pino-логгер
(без текстов отзывов в логах — только id).

## 4.1. Billing — биллинг через ЮKassa (ADR-035..038)

`BillingModule` (`apps/api/src/modules/billing/`): подписки START/BUSINESS на
1/3/6/12 мес с привязкой карты и автопродлением + разовые пакеты генераций
(10/50/100, не сгорают) + отмена с pro-rata возвратом.

**Модели (Prisma).**
- `Subscription` — одна на компанию (`companyId` unique): `plan` (START|BUSINESS),
  `periodMonths` (1|3|6|12), `status` (ACTIVE|CANCELLED|EXPIRED), `price` (копейки),
  `startedAt/expiresAt`, `autoRenew`, `paymentMethodId/cardLast4/cardBrand`
  (сохранённая карта ЮKassa), `cancelledAt/cancelReason`.
- `PaymentTransaction` — журнал платежей: `type` (SUBSCRIPTION|PACKAGE|REFUND),
  `providerPaymentId` (id платежа ЮKassa; для возвратов `refund:{id}`), `amount`,
  `status` (PENDING|SUCCEEDED|FAILED|REFUNDED), `plan/periodMonths/packageSize`,
  `paidAt`.
- `Company.packageCredits` — остаток пакетных генераций.
- `Company.plan` производен от подписки: активная подписка задаёт план, нет
  подписки / истекла → FREE. Sync — при активации (webhook), отмене, в cron
  и лениво в GET /billing.

**Контракты** (`packages/contracts/src/billing.ts`): `BillingOverviewSchema`,
`CheckoutDtoSchema` (discriminated union `kind: subscription|package`),
`CheckoutResponseSchema`, `AutoRenewDtoSchema`, `CancelSubscriptionResponseSchema`,
`PaymentTransactionDtoSchema`. Коды ошибок: `BILLING_DISABLED` (503),
`NO_ACTIVE_SUBSCRIPTION` (409), `NO_BOUND_CARD` (409).

**Эндпоинты** (все по companyId из JWT, кроме отмеченных):
- `GET /billing` — план, подписка (период, expiresAt, autoRenew, карта),
  usage месяца, packageCredits, billingEnabled, последние 20 транзакций.
- `POST /billing/checkout` — `{kind:'subscription',plan,periodMonths}` или
  `{kind:'package',size}` → PENDING-транзакция + платёж ЮKassa (redirect
  confirmation, return_url `{APP_URL}/app/billing?status=ok`,
  `save_payment_method:true` только для подписок, чек НПД: vat_code 1,
  tax_system_code 6) → `{confirmationUrl, transactionId}`. Без ключей ЮKassa — 503.
- `POST /billing/webhook` — ПУБЛИЧНЫЙ (@Public, ЮKassa не умеет JWT). События
  payment.succeeded / payment.canceled / refund.succeeded; аутентичность —
  перепроверкой через GET к API ЮKassa, идемпотентность — CAS PENDING→SUCCEEDED
  (ADR-038). Подписка: upsert + продление от текущего expiresAt; пакет:
  инкремент packageCredits.
- `POST /billing/auto-renew {enabled}` — 409 без подписки/карты.
- `POST /billing/unbind-card` — локальная отвязка (у ЮKassa нет delete) + autoRenew=false.
- `POST /billing/cancel` — CAS ACTIVE→EXPIRED, pro-rata возврат по фактическим
  дням с cap (ADR-036), откат при отказе ЮKassa. План → FREE.
- `POST /billing/cron/renewals` — Bearer `CRON_SECRET`; горизонт 1 час,
  race-защита 15 мин, Idempotence-Key `renewal:{subId}:{expiresAt}`; также
  переводит просроченные подписки в EXPIRED.

**Порядок списания генераций (ADR-037).** `UsageService.reserve()`: сначала
месячный лимит тарифа (условный UPDATE UsageCounter), при исчерпании — атомарный
декремент `Company.packageCredits` (updateMany `>= 1`), иначе 402 LIMIT_EXCEEDED.
Источник (`PLAN|PACKAGE`) едет в job BullMQ; компенсация при FAILED возвращает
в тот же источник.

**ЮKassa-клиент** — собственный fetch-класс `YooKassaClient` (Basic Auth
shop_id:secret_key, обязательный Idempotence-Key; npm-пакет не используется).
Инжектируемый — в интеграционных тестах подменяется
`overrideProvider(YooKassaClient)`, сеть не нужна.

**env**: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` (опциональны — без них
checkout 503), `CRON_SECRET`, `APP_URL`, `PRICE_{START|BUSINESS}_{1|3|6|12}M`,
`PRICE_PACK_{10|50|100}` (копейки, дефолты в .env.example).

## 5. Frontend — страницы и поведение

```
/login /register          # формы, zod-валидация, ошибки под полями;
                          # на /register — два РАЗДЕЛЬНЫХ чекбокса согласий (ADR-033),
                          # кнопка задизейблена, пока не отмечены оба
/legal/[slug]             # публичные юридические документы (без авторизации):
                          # privacy-policy | terms-of-service | consent-pd | consent-llm;
                          # markdown из apps/web/content/legal/*.md, react-markdown без
                          # raw-HTML, generateStaticParams, незнакомый slug → 404;
                          # ссылки также в блоке «Документы» на /app/settings
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
заголовки — не использовать, токен в query запрещён). При FAILED (ADR-042: отзыв на
сервере удалён, лимит компенсирован) — возврат к форме с сохранёнными полями, сообщение
«Лимит не потрачен, текст остался в форме» и кнопка «Повторить генерацию», которая шлёт
текущее содержимое формы новым POST /reviews. Копирование через
navigator.clipboard + тост. Остаток лимита виден всегда; при 402 — экран апгрейда (заглушка).
Состояние сервера — TanStack Query; access-токен в памяти, авто-refresh по 401 (interceptor).

## 6. Качество кода

TypeScript strict, eslint+prettier из packages/config, без any в доменном коде.
Seed-скрипт: тестовый пользователь demo@replydesk.ru / Demo12345!, компания-салон,
5 отзывов с готовыми генерациями (захардкоженные payload, без вызова LLM); минимум 3 из них —
текстово похожие жалобы, чтобы pg_trgm-повторяемость демонстрировалась на demo-данных.
`.env.example` со ВСЕМИ переменными и комментариями. README с запуском за 3 команды.
Юнит-тесты минимум: сборка промпта, проверка лимитов, маппинг ошибок LLM (остальное — на QA-агенте).
