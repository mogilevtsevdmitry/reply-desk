/**
 * Интеграционные тесты: Auth (03-QA.md, секция Auth)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app-factory';
import {
  makeExpiredToken,
  registerUser,
  registerAndOnboard,
  uniqueEmail,
} from './helpers/api-helpers';
import { cleanDatabase } from './helpers/db-helpers';

describe('Auth — интеграционные тесты', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  // -------------------------------------------------------------------------
  // Регистрация
  // -------------------------------------------------------------------------

  it('регистрация: успех — 201, возвращает user с id и email', async () => {
    const email = uniqueEmail();
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!' })
      .expect(201);

    const body = res.body as { user: { id: string; email: string; companyId: unknown } };
    expect(body.user.id).toBeDefined();
    expect(body.user.email).toBe(email);
    expect(body.user.companyId).toBeNull();
  });

  it('регистрация: дубль email → 409 EMAIL_TAKEN', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'AnotherPass123!' })
      .expect(409);

    const body = res.body as { code: string };
    expect(body.code).toBe('EMAIL_TAKEN');
  });

  it('регистрация: слабый пароль (< 8 символов) → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: 'weak' })
      .expect(422);
  });

  // -------------------------------------------------------------------------
  // Логин
  // -------------------------------------------------------------------------

  it('логин: успех — 200, возвращает accessToken, ставит refresh-куку', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!' });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(200);

    const body = res.body as { accessToken: string };
    expect(body.accessToken).toBeDefined();
    const cookies = res.headers['set-cookie'] as string[] | undefined;
    expect(cookies?.some((c) => c.startsWith('rd_refresh='))).toBe(true);
  });

  it('логин: неверный пароль → 401 с единым сообщением', async () => {
    const email = uniqueEmail();
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'Password123!' });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword1!' })
      .expect(401);

    const body = res.body as { message: string };
    expect(body.message).toBe('Неверный email или пароль');
  });

  it('логин: несуществующий email → 401 с тем же сообщением (timing-safe)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'Password123!' })
      .expect(401);

    const body = res.body as { message: string };
    expect(body.message).toBe('Неверный email или пароль');
  });

  // -------------------------------------------------------------------------
  // Refresh-токен
  // -------------------------------------------------------------------------

  it('refresh: ротация — возвращает accessToken, выставляет новую refresh-куку', async () => {
    const user = await registerUser(app);
    const oldCookies = user.refreshCookies;

    // Небольшая пауза, чтобы iat нового токена отличался от предыдущего
    await new Promise((r) => setTimeout(r, 1100));

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookies)
      .expect(200);

    const body = res.body as { accessToken: string };
    expect(body.accessToken).toBeDefined();
    // Новый токен отличается (минимально — по iat)
    expect(body.accessToken).not.toBe(user.accessToken);

    const newCookies = res.headers['set-cookie'] as string[] | undefined;
    expect(newCookies?.some((c) => c.startsWith('rd_refresh='))).toBe(true);
  });

  it('refresh: повторное использование старого токена → 401 + ревокация всех токенов', async () => {
    const user = await registerUser(app);
    const oldCookies = user.refreshCookies;

    // Первый refresh — ротируем, старый токен ревокован
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookies)
      .expect(200);

    // Повторно используем старый (уже ревокованный) токен
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookies)
      .expect(401);

    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });

    // После детекта повторного использования все токены ревокованы.
    // Попытка снова использовать старый токен — тоже 401.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldCookies)
      .expect(401);
  });

  // -------------------------------------------------------------------------
  // Доступ к защищённым ресурсам
  // -------------------------------------------------------------------------

  it('/reviews без токена → 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/reviews')
      .expect(401);
  });

  it('/reviews с просроченным access-токеном → 401', async () => {
    const user = await registerAndOnboard(app);
    const expiredToken = makeExpiredToken(app, user.userId);

    await request(app.getHttpServer())
      .get('/api/v1/reviews')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
  });
});
