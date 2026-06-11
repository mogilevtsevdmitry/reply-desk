import {
  AuthTokenResponseSchema,
  ErrorResponseSchema,
  type ErrorCode,
} from '@replydesk/contracts';
import { getAccessToken, setAccessToken } from './token';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Ошибка API в едином формате { code, message, details? } + HTTP-статус. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Слушатели «сессия истекла» (refresh не удался) — AuthProvider делает redirect. */
const sessionExpiredListeners = new Set<() => void>();
export function onSessionExpired(fn: () => void): () => void {
  sessionExpiredListeners.add(fn);
  return () => sessionExpiredListeners.delete(fn);
}
function emitSessionExpired(): void {
  setAccessToken(null);
  sessionExpiredListeners.forEach((fn) => fn());
}

/** Single-flight refresh: параллельные 401 не порождают параллельных refresh. */
let refreshPromise: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const body = AuthTokenResponseSchema.safeParse(await res.json());
      if (!body.success) return null;
      setAccessToken(body.data.accessToken);
      return body.data.accessToken;
    } catch {
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

async function toApiError(res: Response): Promise<ApiError> {
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // не-JSON тело — оставляем generic
  }
  const body = ErrorResponseSchema.safeParse(parsed);
  if (body.success) {
    return new ApiError(res.status, body.data.code, body.data.message, body.data.details);
  }
  return new ApiError(res.status, 'INTERNAL', 'Внутренняя ошибка сервера');
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
  /** Заголовок Accept для SSE-потока. */
  accept?: string;
}

/**
 * fetch с Authorization-заголовком и авто-refresh по 401 (interceptor):
 * при 401 делается POST /auth/refresh (single-flight) и запрос повторяется один раз;
 * если refresh не удался — событие «сессия истекла» и проброс ошибки.
 * Возвращает «сырой» Response (используется и обычными запросами, и SSE).
 */
export async function apiRequest(path: string, options: RequestOptions = {}): Promise<Response> {
  const doFetch = (token: string | null): Promise<Response> =>
    fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      signal: options.signal,
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.accept ? { Accept: options.accept } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res: Response;
  try {
    res = await doFetch(getAccessToken());
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Нет соединения с сервером');
  }

  if (res.status === 401 && !path.startsWith('/auth/')) {
    const token = await refreshAccessToken();
    if (!token) {
      emitSessionExpired();
      throw await toApiError(res);
    }
    try {
      res = await doFetch(token);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      throw new ApiError(0, 'NETWORK', 'Нет соединения с сервером');
    }
  }

  if (!res.ok) {
    throw await toApiError(res);
  }
  return res;
}

/** JSON-запрос с валидацией ответа схемой из @replydesk/contracts. */
export async function apiJson<T>(
  path: string,
  schema: { parse: (data: unknown) => T },
  options: RequestOptions = {},
): Promise<T> {
  const res = await apiRequest(path, options);
  if (res.status === 204) {
    return schema.parse(undefined);
  }
  return schema.parse(await res.json());
}
