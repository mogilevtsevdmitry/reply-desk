import { Logger } from '@nestjs/common';
import Anthropic, { APIConnectionError, APIConnectionTimeoutError, APIError } from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  GenerateStructuredOptions,
  GenerateStructuredResult,
  LlmInvalidOutputError,
  LlmNetworkError,
  LlmProvider,
  LlmTimeoutError,
} from './llm.types';

/** Таймаут одного HTTP-вызова Anthropic API (ТЗ: 60с). */
const CALL_TIMEOUT_MS = 60_000;
/** Ретраи сетевых ошибок (ТЗ: 2 раза с экспоненциальной паузой). */
const NETWORK_RETRIES = 2;
const BASE_BACKOFF_MS = 500;

const TOOL_NAME = 'emit_result';

/**
 * Обёртка zod-to-json-schema с погашенной генерик-инстанциацией: на произвольной
 * ZodType<T> tsc уходит в TS2589 (excessively deep), сама конвертация корректна.
 */
const toJsonSchema = zodToJsonSchema as unknown as (
  schema: unknown,
  opts: { target: 'jsonSchema7'; $refStrategy: 'none' },
) => Record<string, unknown>;

/** Минимальный срез клиента Anthropic — подменяется в юнит-тестах. */
export interface AnthropicMessagesClient {
  messages: {
    create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
}

/**
 * AnthropicProvider: structured output через tool use с одной tool `emit_result`
 * (zod → JSON Schema). Невалидный ответ → ОДИН повторный запрос с текстом ошибки
 * валидации (tool_result is_error) → затем LlmInvalidOutputError.
 * Собственные ретраи сетевых ошибок (SDK maxRetries=0, чтобы не дублировать политику).
 */
export class AnthropicProvider implements LlmProvider {
  private readonly logger = new Logger(AnthropicProvider.name);
  private readonly client: AnthropicMessagesClient;
  private readonly model: string;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    opts: AnthropicProviderOptions,
    client?: AnthropicMessagesClient,
    sleep?: (ms: number) => Promise<void>,
  ) {
    this.model = opts.model;
    this.client =
      client ?? new Anthropic({ apiKey: opts.apiKey, timeout: CALL_TIMEOUT_MS, maxRetries: 0 });
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async generateStructured<T>(
    opts: GenerateStructuredOptions<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const tool: Anthropic.Tool = {
      name: TOOL_NAME,
      description: 'Передай итоговый структурированный результат строго по схеме.',
      input_schema: toJsonSchema(opts.schema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      }) as Anthropic.Tool.InputSchema,
    };

    const baseMessages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.user }];
    let tokensUsed = 0;

    const first = await this.callWithRetry({
      model: this.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: baseMessages,
      tools: [tool],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    });
    tokensUsed += first.usage.input_tokens + first.usage.output_tokens;

    const firstAttempt = this.tryParse(first, opts.schema);
    if (firstAttempt.ok) {
      return { data: firstAttempt.data, tokensUsed };
    }

    // Один повторный запрос: возвращаем модели её tool_use + ошибку валидации как tool_result.
    this.logger.warn('Невалидный structured output, повторный запрос с текстом ошибки валидации');
    const repairMessages: Anthropic.MessageParam[] = [
      ...baseMessages,
      { role: 'assistant', content: first.content },
      {
        role: 'user',
        content: firstAttempt.toolUseId
          ? [
              {
                type: 'tool_result' as const,
                tool_use_id: firstAttempt.toolUseId,
                is_error: true,
                content: `Результат не прошёл валидацию схемы: ${firstAttempt.error}. Вызови ${TOOL_NAME} ещё раз с исправленным результатом.`,
              },
            ]
          : `Ты не вызвал инструмент ${TOOL_NAME}. Вызови его с результатом строго по схеме.`,
      },
    ];

    const second = await this.callWithRetry({
      model: this.model,
      max_tokens: opts.maxTokens,
      system: opts.system,
      messages: repairMessages,
      tools: [tool],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    });
    tokensUsed += second.usage.input_tokens + second.usage.output_tokens;

    const secondAttempt = this.tryParse(second, opts.schema);
    if (secondAttempt.ok) {
      return { data: secondAttempt.data, tokensUsed };
    }
    throw new LlmInvalidOutputError(
      `Ответ модели не прошёл валидацию схемы после повторного запроса: ${secondAttempt.error}`,
    );
  }

  private tryParse<T>(
    message: Anthropic.Message,
    schema: GenerateStructuredOptions<T>['schema'],
  ): { ok: true; data: T } | { ok: false; error: string; toolUseId: string | null } {
    const block = message.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === TOOL_NAME,
    );
    if (!block) {
      return { ok: false, error: `в ответе нет tool_use ${TOOL_NAME}`, toolUseId: null };
    }
    const parsed = schema.safeParse(block.input);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      return { ok: false, error: issues, toolUseId: block.id };
    }
    return { ok: true, data: parsed.data };
  }

  private async callWithRetry(
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.client.messages.create(params);
      } catch (e) {
        if (this.isRetryable(e) && attempt < NETWORK_RETRIES) {
          const pause = BASE_BACKOFF_MS * 2 ** attempt;
          attempt += 1;
          this.logger.warn(`Сетевая ошибка Anthropic API, ретрай ${attempt}/${NETWORK_RETRIES} через ${pause}мс`);
          await this.sleep(pause);
          continue;
        }
        throw this.mapError(e);
      }
    }
  }

  /** Ретраябельно: ошибки соединения (включая таймаут), 429 и 5xx. */
  private isRetryable(e: unknown): boolean {
    if (e instanceof APIConnectionError) return true;
    if (e instanceof APIError && typeof e.status === 'number') {
      return e.status === 429 || e.status >= 500;
    }
    return false;
  }

  private mapError(e: unknown): Error {
    if (e instanceof APIConnectionTimeoutError) {
      return new LlmTimeoutError('Вызов Anthropic API не уложился в таймаут 60с');
    }
    if (e instanceof APIConnectionError) {
      return new LlmNetworkError('Сетевая ошибка при вызове Anthropic API');
    }
    if (e instanceof APIError && typeof e.status === 'number' && (e.status === 429 || e.status >= 500)) {
      return new LlmNetworkError(`Anthropic API недоступен (HTTP ${e.status})`);
    }
    return e instanceof Error ? e : new Error(String(e));
  }
}
