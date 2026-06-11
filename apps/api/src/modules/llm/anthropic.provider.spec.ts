import Anthropic, { APIConnectionError, APIConnectionTimeoutError } from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AnthropicMessagesClient, AnthropicProvider } from './anthropic.provider';
import { LlmInvalidOutputError, LlmNetworkError, LlmTimeoutError } from './llm.types';

/**
 * Маппинг ошибок LLM (docs/02-DEVELOPER.md, раздел 3): невалидный JSON → один
 * повторный запрос → ошибка; таймаут 60с; ретрай сетевых ошибок 2 раза.
 */

const Schema = z.object({ answer: z.string() });

function message(input: unknown, tokens = 10): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'test',
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [{ type: 'tool_use', id: 'tu_1', name: 'emit_result', input }] as Anthropic.ContentBlock[],
    usage: { input_tokens: tokens, output_tokens: tokens } as Anthropic.Usage,
  } as Anthropic.Message;
}

function makeProvider(create: jest.Mock): { provider: AnthropicProvider; sleep: jest.Mock } {
  const sleep = jest.fn(async () => undefined);
  const client: AnthropicMessagesClient = { messages: { create } };
  const provider = new AnthropicProvider({ apiKey: 'test', model: 'test-model' }, client, sleep);
  return { provider, sleep };
}

const OPTS = { system: 'sys', user: 'user', schema: Schema, maxTokens: 100 };

describe('AnthropicProvider — structured output и маппинг ошибок', () => {
  it('валидный tool_use с первого раза → данные и tokensUsed', async () => {
    const create = jest.fn(async () => message({ answer: 'ок' }, 50));
    const { provider } = makeProvider(create);

    const result = await provider.generateStructured(OPTS);
    expect(result.data).toEqual({ answer: 'ок' });
    expect(result.tokensUsed).toBe(100); // 50 in + 50 out
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('невалидный JSON → один повторный запрос с текстом ошибки валидации → успех', async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce(message({ wrong: 1 }, 10))
      .mockResolvedValueOnce(message({ answer: 'исправлено' }, 20));
    const { provider } = makeProvider(create);

    const result = await provider.generateStructured(OPTS);
    expect(result.data).toEqual({ answer: 'исправлено' });
    expect(result.tokensUsed).toBe(60); // 20 + 40
    expect(create).toHaveBeenCalledTimes(2);

    // Повторный запрос содержит tool_result с ошибкой валидации (is_error).
    const second = create.mock.calls[1][0] as Anthropic.MessageCreateParamsNonStreaming;
    const lastMessage = second.messages[second.messages.length - 1]!;
    const toolResult = (lastMessage.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(toolResult.type).toBe('tool_result');
    expect(toolResult.is_error).toBe(true);
    expect(String(toolResult.content)).toContain('answer');
  });

  it('невалидный JSON и после повторного запроса → LlmInvalidOutputError, ровно 2 вызова', async () => {
    const create = jest.fn(async () => message({ wrong: true }));
    const { provider } = makeProvider(create);

    await expect(provider.generateStructured(OPTS)).rejects.toBeInstanceOf(LlmInvalidOutputError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('ответ без tool_use тоже считается невалидным выводом', async () => {
    const noTool = { ...message({}), content: [{ type: 'text', text: 'просто текст', citations: null }] };
    const create = jest.fn(async () => noTool);
    const { provider } = makeProvider(create);

    await expect(provider.generateStructured(OPTS)).rejects.toBeInstanceOf(LlmInvalidOutputError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('таймаут вызова: 2 ретрая с экспоненциальной паузой, затем LlmTimeoutError', async () => {
    const create = jest.fn(async () => {
      throw new APIConnectionTimeoutError({ message: 'Request timed out.' });
    });
    const { provider, sleep } = makeProvider(create);

    await expect(provider.generateStructured(OPTS)).rejects.toBeInstanceOf(LlmTimeoutError);
    expect(create).toHaveBeenCalledTimes(3); // 1 вызов + 2 ретрая
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]); // экспоненциальная пауза
  });

  it('сетевая ошибка, ушедшая после ретрая → успех', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(new APIConnectionError({ message: 'ECONNRESET' }))
      .mockRejectedValueOnce(new APIConnectionError({ message: 'ECONNRESET' }))
      .mockResolvedValueOnce(message({ answer: 'ок' }));
    const { provider } = makeProvider(create);

    const result = await provider.generateStructured(OPTS);
    expect(result.data).toEqual({ answer: 'ок' });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('сетевая ошибка после исчерпания ретраев → LlmNetworkError', async () => {
    const create = jest.fn(async () => {
      throw new APIConnectionError({ message: 'ECONNREFUSED' });
    });
    const { provider } = makeProvider(create);

    await expect(provider.generateStructured(OPTS)).rejects.toBeInstanceOf(LlmNetworkError);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('невалидный JSON + успешный повтор: сетевые ретраи и валидационный повтор независимы', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(new APIConnectionError({ message: 'сеть моргнула' }))
      .mockResolvedValueOnce(message({ wrong: 1 }))
      .mockResolvedValueOnce(message({ answer: 'ок' }));
    const { provider } = makeProvider(create);

    const result = await provider.generateStructured(OPTS);
    expect(result.data).toEqual({ answer: 'ок' });
    expect(create).toHaveBeenCalledTimes(3); // ретрай сети + повтор валидации
  });
});
