/**
 * Интеграционные тесты: восстановление пароля (ADR-043).
 * MailService — в режиме log (SMTP_HOST не задан в env-setup), сеть не нужна;
 * raw-токен достаём из БД нельзя (там sha256) — создаём пару напрямую через Prisma.
 */
import type { INestApplication } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { MailService } from '../src/modules/mail/mail.service';
import { registerUser, uniqueEmail } from './helpers/api-helpers';
import { createTestApp } from './helpers/app-factory';
import { cleanDatabase } from './helpers/db-helpers';

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

describe('Восстановление пароля — интеграционные тесты', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(app);
  });

  it('MailService в интеграционных тестах работает в режиме log (SMTP не настроен)', () => {
    expect(app.get(MailService).mode).toBe('log');
  });

  it('forgot-password: существующий и несуществующий email — одинаковый ответ 204', async () => {
    const user = await registerUser(app);

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: uniqueEmail() })
      .expect(204);
  });

  it('forgot-password: создаёт токен (sha256, TTL ~1ч) и инвалидирует прежние', async () => {
    const user = await registerUser(app);

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(204);

    const first = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.userId },
    });
    expect(first.usedAt).toBeNull();
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const ttlMs = first.expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(55 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1000);

    // повторный запрос гасит прежний токен
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(204);

    const firstAfter = await prisma.passwordResetToken.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(firstAfter.usedAt).not.toBeNull();
    const active = await prisma.passwordResetToken.findMany({
      where: { userId: user.userId, usedAt: null },
    });
    expect(active).toHaveLength(1);
  });

  it('полный флоу: forgot → reset → старый refresh невалиден, логин с новым паролем работает', async () => {
    const user = await registerUser(app);

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: user.email })
      .expect(204);

    // raw-токен в БД не хранится (только sha256) — подменяем хэш известной парой,
    // что эквивалентно «достали токен из письма»
    const rawToken = randomBytes(32).toString('hex');
    const stored = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.userId, usedAt: null },
    });
    await prisma.passwordResetToken.update({
      where: { id: stored.id },
      data: { tokenHash: sha256(rawToken) },
    });

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'BrandNewPass123' })
      .expect(204);

    // старый refresh ревокован → 401
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', user.refreshCookies)
      .expect(401);

    // старый пароль больше не подходит
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(401);

    // новый пароль работает
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'BrandNewPass123' })
      .expect(200);

    // токен одноразовый: повторный reset тем же токеном → 422
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'AnotherPass123' })
      .expect(422);
    expect((res.body as { code: string }).code).toBe('INVALID_TOKEN');
  });

  it('reset-password: протухший токен → 422 INVALID_TOKEN, пароль не меняется', async () => {
    const user = await registerUser(app);
    const rawToken = randomBytes(32).toString('hex');
    await prisma.passwordResetToken.create({
      data: {
        userId: user.userId,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() - 1000), // уже истёк
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: rawToken, password: 'BrandNewPass123' })
      .expect(422);
    expect((res.body as { code: string }).code).toBe('INVALID_TOKEN');

    // старый пароль продолжает работать
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);
  });

  it('reset-password: несуществующий токен → 422 INVALID_TOKEN', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: randomBytes(32).toString('hex'), password: 'BrandNewPass123' })
      .expect(422);
    expect((res.body as { code: string }).code).toBe('INVALID_TOKEN');
  });

  it('reset-password: валидация пароля как при регистрации (< 8 символов → 422 VALIDATION_ERROR)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: randomBytes(32).toString('hex'), password: 'short' })
      .expect(422);
    expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });
});
