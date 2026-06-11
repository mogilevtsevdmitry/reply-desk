# QA-отчёт — этап 3 (2026-06-11)

Покрытие матрицы из docs/03-QA.md. Команды: `pnpm --filter @replydesk/api test` (юниты),
`pnpm --filter @replydesk/api test:int` (интеграционные, Testcontainers),
`pnpm --filter @replydesk/web test:e2e` (Playwright, изолированное окружение :4100/:3100).

## Итоговый счёт

| Слой | Тестов | Статус |
|---|---|---|
| Юнит (apps/api) | 58 | ✅ passed |
| Интеграционные API (Testcontainers) | 38 | ✅ passed |
| E2E Playwright (apps/web) | 16 | ✅ passed |
| **Всего** | **112** | **✅ 112/112** |

## Покрытие матрицы 03-QA.md

- **Auth** (10 кейсов: регистрация/дубль/слабый пароль, логин с единым сообщением,
  ротация refresh, reuse → ревокация всех, 401 без/с протухшим токеном) — ✅ passed
- **Company / онбординг** (5: единократность, 409, валидация toneOfVoice,
  accessToken с companyId, usage в /company/me) — ✅ passed
- **Reviews + лимиты** (11: 422-валидации, happy path 202+PENDING, authorName,
  11-я генерация → 402, компенсация лимита при FAILED, конкурентность 5×POST при
  остатке 1 → ровно одна, retry FAILED/не-FAILED, изоляция тенантов → 404) — ✅ passed
- **Пайплайн генерации** (7: порядок статусов в SSE, payload в 4 полях, невалидный
  JSON → ретрай → FAILED, таймаут → FAILED + финальное SSE, похожие отзывы
  isRepeat/similarReviewIds только своего тенанта, SSE чужой генерации → 404) — ✅ passed
- **E2E** (сценарии 1–5 + XSS: полный happy path с clipboard, фильтры истории,
  FAILED → «Повторить» → DONE, 402 → экран апгрейда, happy path на 360×800,
  XSS-проба `<script>`/`onerror`) — ✅ passed
- **Нефункциональные** (p95 POST /reviews < 300ms на 20+ запросах, SSE доживает до
  финального события, XSS на уровне API — текст не искажается) — ✅ passed

## Баги (docs/qa/BUGS.md)

| ID | Severity | Описание | Статус |
|---|---|---|---|
| BUG-001 | major | Валидация возвращала 400 вместо 422 по контракту | fixed |
| BUG-002 | minor | ThrottlerGuard не переопределялся в тестовой фабрике | fixed (обход в тестах) |
| BUG-003 | major | NEXT_PUBLIC_API_URL бакируется при build — сборка со старым URL API | fixed (документировано: пересборка web при смене API URL обязательна) |
| BUG-004 | major | Логин-флоу global-setup зависал на waitForURL без навигации | fixed (тестовая инфраструктура) |
| BUG-005 | minor | Ложное срабатывание XSS-пробы на подстроке в value | fixed (тест) |

Открытых blocker/major багов нет.

## Замечания для следующих этапов

- Безопаснику: ADR-026 — email пользователя сохраняется в localStorage (`rd_email`)
  для CTA-тоста; оценить приемлемость (PII в localStorage).
- DevOps: BUG-003 — `NEXT_PUBLIC_API_URL` фиксируется на этапе `next build`;
  в Dockerfile web передавать как build-arg, в DEPLOY.md описать.
- Лимиты throttler настраиваемы через env (ADR-025), продакшен-дефолты 10/60 не менялись.

## Вердикт

**Продукт готов к передаче безопаснику (этап 4).** Вся матрица автоматизирована,
112/112 зелёные, blocker/major отсутствуют.
