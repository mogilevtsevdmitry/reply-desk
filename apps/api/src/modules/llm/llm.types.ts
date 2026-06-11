import type { ZodType } from 'zod';

/** DI-токен провайдера LLM (LlmModule выбирает реализацию по env LLM_PROVIDER). */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface GenerateStructuredOptions<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  maxTokens: number;
}

export interface GenerateStructuredResult<T> {
  data: T;
  tokensUsed: number;
}

/**
 * Провайдер-агностичный интерфейс AI-слоя (docs/02-DEVELOPER.md, раздел 3).
 * Structured output: реализация обязана вернуть данные, валидные по переданной zod-схеме.
 */
export interface LlmProvider {
  generateStructured<T>(opts: GenerateStructuredOptions<T>): Promise<GenerateStructuredResult<T>>;
}

/** Базовый класс ошибок LLM-слоя — воркер маппит их в Generation.error. */
export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Вызов не уложился в таймаут (60с), включая исчерпанные ретраи. */
export class LlmTimeoutError extends LlmError {}

/** Сетевая ошибка / недоступность API после исчерпания ретраев. */
export class LlmNetworkError extends LlmError {}

/** Ответ не прошёл валидацию схемой и после одного повторного запроса. */
export class LlmInvalidOutputError extends LlmError {}
