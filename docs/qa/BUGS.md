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

*Документ создан: 2026-06-11. QA-агент задача 3.1.*
