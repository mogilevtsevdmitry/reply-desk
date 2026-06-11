import { AccessTokenPayloadSchema, type AccessTokenPayload } from '@replydesk/contracts';

/**
 * Access-токен живёт ТОЛЬКО в памяти (требование безопасности, ADR-004/005):
 * ни localStorage, ни cookie. Сессия восстанавливается POST /auth/refresh
 * по httpOnly refresh-куке при старте приложения.
 */

let accessToken: string | null = null;
const listeners = new Set<() => void>();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  listeners.forEach((fn) => fn());
}

export function subscribeToken(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Полезная нагрузка текущего access-JWT (sub, companyId) без проверки подписи. */
export function decodeAccessPayload(token: string | null = accessToken): AccessTokenPayload | null {
  if (!token) return null;
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return null;
  try {
    const json = atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/'));
    const parsed = AccessTokenPayloadSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
