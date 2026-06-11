import type { GenStatus } from '@replydesk/contracts';

/** Канал Redis pub/sub статусов генерации (каждый переход публикуется сюда). */
export function genChannel(generationId: string): string {
  return `gen:${generationId}`;
}

/** Финальные статусы — после них SSE-поток закрывается. */
export function isFinalStatus(status: GenStatus): boolean {
  return status === 'DONE' || status === 'FAILED';
}
