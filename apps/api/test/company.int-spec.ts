/**
 * Интеграционные тесты: Company / онбординг (03-QA.md, секция Company)
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app-factory';
import { registerUser, registerAndOnboard } from './helpers/api-helpers';
import { cleanDatabase } from './helpers/db-helpers';

describe('Company — интеграционные тесты', () => {
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

  it('создание компании: успех — 201, возвращает company + новый accessToken с companyId', async () => {
    const user = await registerUser(app);

    const res = await request(app.getHttpServer())
      .post('/api/v1/company')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        name: 'Мой Салон',
        niche: 'SALON',
        toneOfVoice: { tone: 'neutral', examples: [] },
      })
      .expect(201);

    const body = res.body as {
      company: { id: string; name: string };
      accessToken: string;
    };
    expect(body.company.id).toBeDefined();
    expect(body.company.name).toBe('Мой Салон');
    expect(body.accessToken).toBeDefined();
    expect(body.accessToken).not.toBe(user.accessToken);

    // Декодируем токен и проверяем, что companyId заполнен
    const [, payloadB64] = body.accessToken.split('.');
    if (!payloadB64) throw new Error('Invalid token');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as {
      companyId: string;
    };
    expect(payload.companyId).toBe(body.company.id);
  });

  it('повторный POST /company → 409 COMPANY_EXISTS', async () => {
    const user = await registerUser(app);

    await request(app.getHttpServer())
      .post('/api/v1/company')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        name: 'Первая компания',
        niche: 'SALON',
        toneOfVoice: { tone: 'neutral', examples: [] },
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/api/v1/company')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        name: 'Вторая попытка',
        niche: 'DENTAL',
        toneOfVoice: { tone: 'soft', examples: [] },
      })
      .expect(409);

    const body = res.body as { code: string };
    expect(body.code).toBe('COMPANY_EXISTS');
  });

  it('toneOfVoice: больше 3 примеров → 422', async () => {
    const user = await registerUser(app);

    await request(app.getHttpServer())
      .post('/api/v1/company')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        name: 'Тест',
        niche: 'SALON',
        toneOfVoice: {
          tone: 'neutral',
          examples: ['Пример 1', 'Пример 2', 'Пример 3', 'Пример 4'],
        },
      })
      .expect(422);
  });

  it('toneOfVoice: пример > 1000 символов → 422', async () => {
    const user = await registerUser(app);
    const longExample = 'А'.repeat(1001);

    await request(app.getHttpServer())
      .post('/api/v1/company')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        name: 'Тест',
        niche: 'SALON',
        toneOfVoice: {
          tone: 'neutral',
          examples: [longExample],
        },
      })
      .expect(422);
  });

  it('GET /company/me возвращает компанию с usage', async () => {
    const user = await registerAndOnboard(app);

    const res = await request(app.getHttpServer())
      .get('/api/v1/company/me')
      .set('Authorization', `Bearer ${user.companyToken}`)
      .expect(200);

    const body = res.body as {
      id: string;
      usage: { used: number; limit: number; period: string };
    };
    expect(body.id).toBe(user.companyId);
    expect(body.usage).toBeDefined();
    expect(body.usage.limit).toBe(10); // FREE plan
    expect(body.usage.used).toBe(0);
  });
});
