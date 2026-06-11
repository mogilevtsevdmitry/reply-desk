import { GenerationEventSchema, type GenerationEvent } from '@replydesk/contracts';
import { apiRequest } from './client';

/**
 * SSE-подписка на статусы генерации — строго fetch + ReadableStream с заголовком
 * Authorization (ADR-004; нативный EventSource и токен в query запрещены).
 *
 * Формат потока: `data: {status, payload?, error?}\n\n`;
 * keep-alive строки начинаются с ':' и игнорируются.
 *
 * Резолвится финальным событием (DONE/FAILED). Если поток оборвался без
 * финального события — бросает SseLostError (фронт показывает error-sse-lost).
 */
export class SseLostError extends Error {
  constructor() {
    super('SSE connection lost before final event');
    this.name = 'SseLostError';
  }
}

export async function streamGenerationEvents(
  generationId: string,
  onEvent: (event: GenerationEvent) => void,
  signal?: AbortSignal,
): Promise<GenerationEvent> {
  const res = await apiRequest(`/generations/${generationId}/events`, {
    accept: 'text/event-stream',
    signal,
  });
  if (!res.body) throw new SseLostError();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalEvent: GenerationEvent | null = null;

  const handleChunk = (chunk: string): void => {
    buffer += chunk;
    let sep: number;
    // Сообщения разделяются пустой строкой
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const rawMessage = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of rawMessage.split('\n')) {
        if (line.startsWith(':')) continue; // keep-alive
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const parsed = GenerationEventSchema.safeParse(json);
        if (!parsed.success) continue;
        onEvent(parsed.data);
        if (parsed.data.status === 'DONE' || parsed.data.status === 'FAILED') {
          finalEvent = parsed.data;
        }
      }
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) handleChunk(decoder.decode(value, { stream: true }));
      if (finalEvent) return finalEvent;
      if (done) break;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }

  throw new SseLostError();
}
