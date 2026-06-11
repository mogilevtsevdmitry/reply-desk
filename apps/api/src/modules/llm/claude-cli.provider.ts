import { execFile } from 'node:child_process';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodType } from 'zod';
import {
  GenerateStructuredOptions,
  GenerateStructuredResult,
  LlmInvalidOutputError,
  LlmNetworkError,
  LlmProvider,
  LlmTimeoutError,
} from './llm.types';

/** См. комментарий к toJsonSchema в anthropic.provider.ts. */
const toJsonSchema = zodToJsonSchema as unknown as (schema: ZodType<unknown>) => object;

/** Формат обёртки ответа `claude -p --output-format json`. */
interface ClaudeCliEnvelope {
  is_error?: boolean;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

const CLI_TIMEOUT_MS = 120_000;

/**
 * Dev-only провайдер (ADR-031): структурированная генерация через локальный
 * Claude Code CLI (`claude -p`) — использует подписку локальной сессии,
 * API-ключ не нужен. Включается env LLM_PROVIDER=claude-cli; в прод-образах
 * недоступен (CLI в контейнере отсутствует — фабрика модуля упадёт на старте).
 *
 * Tool use в headless CLI недоступен, поэтому контракт схемы обеспечивается
 * инструкцией «только JSON по схеме» + zod-валидацией; невалидный ответ —
 * один повторный запрос с текстом ошибки (та же семантика, что у AnthropicProvider).
 */
export class ClaudeCliProvider implements LlmProvider {
  constructor(private readonly model: string = 'sonnet') {}

  async generateStructured<T>(
    opts: GenerateStructuredOptions<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const jsonSchema = JSON.stringify(toJsonSchema(opts.schema));
    const basePrompt = [
      opts.system,
      '',
      '# Формат вывода (обязательный)',
      'Ответь ОДНИМ JSON-объектом, строго соответствующим JSON-схеме ниже.',
      'Без markdown-ограждений, без пояснений до или после JSON.',
      `JSON-схема: ${jsonSchema}`,
      '',
      opts.user,
    ].join('\n');

    let tokensTotal = 0;
    let lastError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const prompt =
        attempt === 0
          ? basePrompt
          : `${basePrompt}\n\nПредыдущий ответ не прошёл валидацию схемой: ${lastError}\nВерни исправленный JSON.`;
      const envelope = await this.invokeCli(prompt);
      tokensTotal +=
        (envelope.usage?.input_tokens ?? 0) + (envelope.usage?.output_tokens ?? 0);
      const parsed = opts.schema.safeParse(this.extractJson(envelope.result ?? ''));
      if (parsed.success) {
        return { data: parsed.data, tokensUsed: tokensTotal };
      }
      lastError = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
    }
    throw new LlmInvalidOutputError(
      `Ответ claude-cli не прошёл валидацию схемой после повторного запроса: ${lastError}`,
    );
  }

  /** Запуск `claude -p` без инструментов; маппинг ошибок в иерархию LlmError. */
  private invokeCli(prompt: string): Promise<ClaudeCliEnvelope> {
    return new Promise((resolve, reject) => {
      execFile(
        'claude',
        [
          '-p',
          prompt,
          '--output-format',
          'json',
          '--model',
          this.model,
          '--max-turns',
          '1',
          '--disallowed-tools',
          '*',
        ],
        { timeout: CLI_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            if (error.killed) {
              reject(
                new LlmTimeoutError(`claude-cli не ответил за ${CLI_TIMEOUT_MS / 1000}с`),
              );
              return;
            }
            reject(new LlmNetworkError(`claude-cli завершился с ошибкой: ${error.message}`));
            return;
          }
          try {
            const envelope = JSON.parse(stdout) as ClaudeCliEnvelope;
            if (envelope.is_error) {
              reject(new LlmNetworkError('claude-cli вернул is_error=true'));
              return;
            }
            resolve(envelope);
          } catch {
            reject(new LlmInvalidOutputError('Нечитаемая обёртка ответа claude-cli'));
          }
        },
      );
    });
  }

  /** Модель может обернуть JSON в ```-ограждения — извлекаем первый объект. */
  private extractJson(text: string): unknown {
    const trimmed = text.trim();
    const candidate =
      trimmed.startsWith('{') && trimmed.endsWith('}')
        ? trimmed
        : trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  }
}
