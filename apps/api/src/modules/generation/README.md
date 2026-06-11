# GenerationModule — заглушка-граница

Реализуется в задаче 2.2 (генерационный конвейер):

- producer + BullMQ worker (очередь `generation`, concurrency 5);
- SSE-контроллер `GET /generations/:id/events` (auth — fetch + Authorization, ADR-004);
- LlmModule с интерфейсом `LlmProvider` и `AnthropicProvider`;
- при FAILED — `UsageService.compensate()` (ADR-002).

Контракты payload (4 блока) и событий SSE уже готовы в `@replydesk/contracts`
(generation.ts). Redis-клиент доступен через DI-токен `REDIS` (redis/redis.module.ts).
