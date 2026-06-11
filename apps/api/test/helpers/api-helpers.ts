/**
 * Хелперы для типичных API-операций в интеграционных тестах.
 * Регистрация, логин, онбординг — общие шаги для большинства тестов.
 */
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

export interface RegisteredUser {
  userId: string;
  email: string;
  password: string;
  accessToken: string;
  refreshCookies: string[];
}

export interface OnboardedUser extends RegisteredUser {
  companyId: string;
  /** accessToken с companyId — выдаётся после POST /company */
  companyToken: string;
}

let userCounter = 0;

/** Генерирует уникальный email для теста. */
export function uniqueEmail(): string {
  return `test-${++userCounter}-${Date.now()}@example.com`;
}

/** Регистрирует пользователя и возвращает его данные. */
export async function registerUser(
  app: INestApplication,
  email = uniqueEmail(),
  password = 'Password123!',
): Promise<RegisteredUser> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password, acceptTerms: true, acceptLlm: true })
    .expect(201);

  const userId = (res.body as { user: { id: string } }).user.id;

  const loginRes = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);

  const accessToken = (loginRes.body as { accessToken: string }).accessToken;
  const refreshCookies = loginRes.headers['set-cookie'] as string[] | undefined ?? [];

  return { userId, email, password, accessToken, refreshCookies };
}

/** Регистрирует пользователя и создаёт компанию (онбординг). */
export async function registerAndOnboard(
  app: INestApplication,
  opts: {
    email?: string;
    password?: string;
    companyName?: string;
    niche?: string;
  } = {},
): Promise<OnboardedUser> {
  const user = await registerUser(app, opts.email, opts.password);

  const companyRes = await request(app.getHttpServer())
    .post('/api/v1/company')
    .set('Authorization', `Bearer ${user.accessToken}`)
    .send({
      name: opts.companyName ?? 'Тестовый Салон',
      niche: opts.niche ?? 'SALON',
      toneOfVoice: { tone: 'neutral', examples: [] },
    })
    .expect(201);

  const body = companyRes.body as { company: { id: string }; accessToken: string };
  const companyId = body.company.id;
  const companyToken = body.accessToken;

  return { ...user, companyId, companyToken };
}

/** Создаёт отзыв и возвращает { reviewId, generationId }. */
export async function createReview(
  app: INestApplication,
  companyToken: string,
  rawText: string,
  opts: {
    source?: string;
    rating?: number;
    authorName?: string;
  } = {},
): Promise<{ reviewId: string; generationId: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/reviews')
    .set('Authorization', `Bearer ${companyToken}`)
    .send({
      source: opts.source ?? 'YANDEX_MAPS',
      rawText,
      ...(opts.rating !== undefined ? { rating: opts.rating } : {}),
      ...(opts.authorName !== undefined ? { authorName: opts.authorName } : {}),
    })
    .expect(202);

  return res.body as { reviewId: string; generationId: string };
}

/**
 * Подписывается на SSE-поток генерации и собирает все события.
 * Возвращает список распарсенных объектов. Ждёт финального события или таймаута.
 */
export async function collectSseEvents(
  app: INestApplication,
  generationId: string,
  accessToken: string,
  timeoutMs = 30_000,
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const events: Array<Record<string, unknown>> = [];
    const timer = setTimeout(() => resolve(events), timeoutMs);

    const req = request(app.getHttpServer())
      .get(`/api/v1/generations/${generationId}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'text/event-stream')
      .buffer(false)
      .parse((res, callback) => {
        let buf = '';
        res.on('data', (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const raw = line.slice(6).trim();
              if (raw) {
                try {
                  const evt = JSON.parse(raw) as Record<string, unknown>;
                  events.push(evt);
                  const status = evt['status'] as string | undefined;
                  if (status === 'DONE' || status === 'FAILED') {
                    clearTimeout(timer);
                    callback(null, events);
                  }
                } catch {
                  // ignore malformed
                }
              }
            }
          }
        });
        res.on('end', () => {
          clearTimeout(timer);
          callback(null, events);
        });
        res.on('error', (err: Error) => {
          clearTimeout(timer);
          reject(err);
        });
      });

    void req.then(() => resolve(events)).catch(reject);
  });
}

/**
 * Создаёт просроченный access-токен для тестирования 401.
 */
export function makeExpiredToken(app: INestApplication, userId: string): string {
  const jwtService = app.get(JwtService);
  return jwtService.sign(
    { sub: userId, companyId: null },
    { expiresIn: '-1s' },
  );
}
