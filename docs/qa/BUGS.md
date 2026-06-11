# BUGS — журнал найденных дефектов

## BUG-001: ZodValidationPipe возвращает 400 вместо 422

**Severity:** major

**Статус:** ИСПРАВЛЕНО (исправлено QA-агентом в рамках задачи 3.1)

**Описание:**
`ZodValidationPipe` выбрасывал `AppException('VALIDATION_ERROR', ..., 400)`,
хотя по ТЗ ошибки валидации должны возвращать **422 Unprocessable Entity**.

**Шаги воспроизведения:**
```
POST /api/v1/auth/register { email: "test@example.com", password: "weak" }
→ HTTP 400 Bad Request { code: "VALIDATION_ERROR" }
```

**Ожидалось:** HTTP 422 Unprocessable Entity

**Фактически:** HTTP 400 Bad Request

**Исправление:**
- `apps/api/src/common/zod-validation.pipe.ts`: изменён status с `400` на `422`
- `apps/api/src/common/all-exceptions.filter.ts`: добавлен маппинг `422 → VALIDATION_ERROR`

**Проверяющий тест:** `test/auth.int-spec.ts` — «регистрация: слабый пароль → 422»,
`test/reviews.int-spec.ts` — «пустой текст → 422», «неверный source → 422» и т.д.

---

## BUG-002: ThrottlerGuard не переопределяется через стандартный механизм в тестах

**Severity:** minor (инфраструктурная)

**Статус:** ОБХОДНОЙ ПУТЬ (solved in test setup)

**Описание:**
При использовании `overrideProvider(ThrottlerGuard).useClass(...)` rate limit
продолжал срабатывать в интеграционных тестах (429 Too Many Requests).

**Причина:** `APP_GUARD` — multi-provider; `useClass: ThrottlerGuard` создаёт
экземпляр через DI, и override класса работает только если у класса нет
Redis-зависимостей, инициализируемых при разрешении.

**Обходной путь:** Переопределение `ThrottlerStorage` на заглушку (`NoopThrottlerStorage`)
в `apps/api/test/helpers/app-factory.ts` — хранилище всегда сообщает о `totalHits=1`,
что не блокирует запросы.

**Рекомендация разработчику:** Предусмотреть переменную окружения
`THROTTLE_DISABLED=true` для тестовых окружений, которую считывает AppModule.

---

---

## BUG-003: E2E global-setup таймаутится из-за жёстко закодированного URL API в Next.js-сборке

**Severity:** major (инфраструктурная — блокировала весь E2E-прогон)

**Статус:** ИСПРАВЛЕНО (задача 3.2)

**Описание:**
`NEXT_PUBLIC_API_URL` — build-time переменная Next.js, бакируется в JS-чанки при сборке.
E2E-окружение запускало `next start` с `NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1`,
но сборка была выполнена без этой переменной, поэтому в собранных чанках был хардкод
`http://localhost:4000/api/v1`. Браузер в Playwright пытался подключиться к порту 4000
(на котором ничего не слушало) и получал «Нет соединения с сервером».

**Шаги воспроизведения:**
1. `pnpm build` (без NEXT_PUBLIC_API_URL)
2. `PORT=3100 NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1 pnpm start`
3. Playwright: `page.goto('http://localhost:3100/login')` → заполнить форму → клик → timeout

**Ожидалось:** login успешен, редирект на /app

**Фактически:** «Нет соединения с сервером» (network error на /auth/login к порту 4000)

**Исправление:**
Сборка E2E-окружения теперь выполняется с `NEXT_PUBLIC_API_URL=http://localhost:4100/api/v1`.

---

## BUG-004: E2E global-setup — waitForURL таймаут при логине существующего пользователя

**Severity:** major (инфраструктурная — предотвращала создание storageState для fixture-пользователей)

**Статус:** ИСПРАВЛЕНО (задача 3.2)

**Описание:**
`global-setup.ts` пытался залогинить существующего пользователя через UI-форму.
После клика «Войти в пульт» (успешный логин) Next.js Router делает `router.replace('/app')`
— это клиентская навигация без полной перезагрузки страницы. Playwright's `waitForURL`
использует Chromium internal "waiting for navigation until load", что не срабатывает
для клиентских SPA-навигаций в некоторых сценариях.
Дополнительная проблема: если предыдущий storageState содержал валидный `rd_refresh`-cookie,
браузер автоматически восстанавливал сессию ещё до заполнения формы.

**Шаги воспроизведения:**
1. Запустить E2E global-setup повторно (пользователи уже существуют, isNew=false)
2. Playwright: goto('/login') → fill → click → waitForURL timeout

**Исправление:**
- `createUserSession` всегда создаёт ЧИСТЫЙ browser-context (без предыдущего storageState),
  поэтому rd_refresh-cookie отсутствует и авто-редирект не происходит
- Добавлено ожидание видимости email-поля перед заполнением формы
  (`waitFor({ state: 'visible' })`) — гарантирует завершение bootstrap-фазы авторизации

---

## BUG-005: XSS-тест ложно-срабатывает из-за substring-поиска по innerHTML

**Severity:** minor (тестовый артефакт)

**Статус:** ИСПРАВЛЕНО (задача 3.2)

**Описание:**
Тест `img onerror XSS` проверял `document.body.innerHTML.includes('onerror=')` для
обнаружения инъецированного атрибута onerror. Однако XSS-payload содержит строку
`onerror="alert(2)"` как значение textarea. React рендерит textarea-значение в DOM,
и строка `onerror=` оказывается в `innerHTML` как часть текстового значения поля ввода
(в `value`-атрибуте или textContent), не как реальный event handler.

**Ожидалось:** `false` (нет реальных onerror-атрибутов)

**Фактически:** `true` (найдена строка "onerror=" в text content/value textarea)

**Исправление:**
Заменён substring-поиск на `querySelectorAll('[onerror]').length > 0` —
проверяет наличие РЕАЛЬНЫХ HTML-атрибутов, а не подстрок в текстовом содержимом.

---

*Документ обновлён: 2026-06-11. QA-агент задача 3.2.*
