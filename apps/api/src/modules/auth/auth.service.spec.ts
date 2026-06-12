import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { RefreshToken, User } from '@prisma/client';
import { RegisterDtoSchema, type RegisterDto } from '@replydesk/contracts';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { AppException } from '../../common/app.exception';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import type { MailService } from '../mail/mail.service';
import { AuthService, CONSENT_DOCS_VERSION } from './auth.service';

/** Тесты ротации refresh-токена, детекта повторного использования и login-флоу. БД мокается. */

// bcryptjs с реальной имплементацией, но compare обёрнут в jest.fn —
// чтобы проверить фиктивное сравнение при отсутствии пользователя.
jest.mock('bcryptjs', () => {
  const actual = jest.requireActual<typeof import('bcryptjs')>('bcryptjs');
  return { ...actual, compare: jest.fn(actual.compare) };
});

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

interface PrismaMock {
  user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  refreshToken: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  passwordResetToken: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
  $transaction: jest.Mock;
}

function makePrisma(): PrismaMock {
  return {
    user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    refreshToken: {
      findUnique: jest.fn(),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'rt-new',
        revokedAt: null,
        ...data,
      })),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    passwordResetToken: {
      findUnique: jest.fn(),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'prt-new',
        usedAt: null,
        createdAt: new Date(),
        ...data,
      })),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    // $transaction(promises[]) — в моках достаточно дождаться переданных промисов
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
}

function makeMail(): { send: jest.Mock; mode: 'log' } {
  return { send: jest.fn(async () => undefined), mode: 'log' };
}

function makeJwt(): { sign: jest.Mock } {
  return { sign: jest.fn((payload: Record<string, unknown>) => `jwt:${JSON.stringify(payload)}`) };
}

function makeConfig(): ConfigService<Env, true> {
  const env: Partial<Env> = {
    REFRESH_TTL_DAYS: 30,
    NODE_ENV: 'test',
    APP_URL: 'http://localhost:3001',
  };
  return {
    get: jest.fn((key: keyof Env) => env[key]),
  } as unknown as ConfigService<Env, true>;
}

function makeService(prisma: PrismaMock, jwt = makeJwt(), mail = makeMail()): AuthService {
  return new AuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    makeConfig(),
    mail as unknown as MailService,
  );
}

const user: User = {
  id: 'u1',
  email: 'owner@example.com',
  passwordHash: bcrypt.hashSync('Correct12345', 4), // низкий cost только для скорости тестов
  companyId: 'c1',
  createdAt: new Date('2026-06-01T00:00:00Z'),
  consentPdAt: new Date('2026-06-01T00:00:00Z'),
  consentLlmAt: new Date('2026-06-01T00:00:00Z'),
  consentDocsVersion: 'v1.0',
};

describe('AuthService — ротация refresh-токена', () => {
  it('валидный refresh: старый токен ревокуется, выпускается новая пара', async () => {
    const prisma = makePrisma();
    const jwt = makeJwt();
    const stored: RefreshToken & { user: User } = {
      id: 'rt1',
      userId: 'u1',
      tokenHash: sha256('old-token'),
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: null,
      user,
    };
    prisma.refreshToken.findUnique.mockResolvedValue(stored);
    const service = makeService(prisma, jwt);

    const tokens = await service.refresh('old-token');

    // старый ревокован
    expect(prisma.refreshToken.update).toHaveBeenCalledWith({
      where: { id: 'rt1' },
      data: { revokedAt: expect.any(Date) },
    });
    // новый создан с другим хэшем
    const createArg = prisma.refreshToken.create.mock.calls[0]![0] as {
      data: { tokenHash: string; userId: string };
    };
    expect(createArg.data.userId).toBe('u1');
    expect(createArg.data.tokenHash).not.toBe(stored.tokenHash);
    expect(createArg.data.tokenHash).toBe(sha256(tokens.refreshToken));
    // access-токен с актуальным companyId из БД (ADR-005)
    expect(jwt.sign).toHaveBeenCalledWith({ sub: 'u1', companyId: 'c1' });
  });

  it('повторное использование ревокованного токена → ревокация ВСЕХ токенов юзера + 401', async () => {
    const prisma = makePrisma();
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      tokenHash: sha256('stolen-token'),
      expiresAt: new Date(Date.now() + 86_400_000),
      revokedAt: new Date(Date.now() - 1000), // уже был ротирован
      user,
    });
    const service = makeService(prisma);

    await expect(service.refresh('stolen-token')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });

  it('неизвестный токен → 401 без ревокаций', async () => {
    const prisma = makePrisma();
    prisma.refreshToken.findUnique.mockResolvedValue(null);
    const service = makeService(prisma);

    await expect(service.refresh('ghost')).rejects.toBeInstanceOf(AppException);
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('истёкший (но не ревокованный) токен → 401 без выпуска новой пары', async () => {
    const prisma = makePrisma();
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt1',
      userId: 'u1',
      tokenHash: sha256('expired'),
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      user,
    });
    const service = makeService(prisma);

    await expect(service.refresh('expired')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(prisma.refreshToken.create).not.toHaveBeenCalled();
  });
});

describe('AuthService — login', () => {
  it('неизвестный email и неверный пароль дают одинаковую ошибку INVALID_CREDENTIALS', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    prisma.user.findUnique.mockResolvedValue(null);
    const errUnknown = await service
      .login({ email: 'ghost@example.com', password: 'Whatever123' })
      .catch((e: AppException) => e);

    prisma.user.findUnique.mockResolvedValue(user);
    const errWrongPass = await service
      .login({ email: user.email, password: 'WrongPass123' })
      .catch((e: AppException) => e);

    expect(errUnknown).toBeInstanceOf(AppException);
    expect(errWrongPass).toBeInstanceOf(AppException);
    expect((errUnknown as AppException).message).toBe((errWrongPass as AppException).message);
    expect((errUnknown as AppException).code).toBe('INVALID_CREDENTIALS');
    expect((errWrongPass as AppException).code).toBe('INVALID_CREDENTIALS');
  });

  it('при отсутствии юзера выполняется фиктивный bcrypt-compare (timing-safe)', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    prisma.user.findUnique.mockResolvedValue(null);
    const compareMock = bcrypt.compare as unknown as jest.Mock;
    compareMock.mockClear();

    await service
      .login({ email: 'ghost@example.com', password: 'Whatever123' })
      .catch(() => undefined);

    expect(compareMock).toHaveBeenCalledTimes(1);
    // сравнение шло с фиктивным bcrypt-хэшем, а не с пустым значением
    expect(String(compareMock.mock.calls[0]![1])).toMatch(/^\$2[aby]\$/);
  });

  it('успешный login возвращает access + refresh, refresh сохраняется хэшем', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);
    prisma.user.findUnique.mockResolvedValue(user);

    const tokens = await service.login({ email: user.email, password: 'Correct12345' });

    expect(tokens.accessToken).toContain('"sub":"u1"');
    const createArg = prisma.refreshToken.create.mock.calls[0]![0] as {
      data: { tokenHash: string };
    };
    expect(createArg.data.tokenHash).toBe(sha256(tokens.refreshToken));
    expect(createArg.data.tokenHash).not.toBe(tokens.refreshToken); // в БД только хэш
  });
});

describe('AuthService — регистрация с согласиями (152-ФЗ)', () => {
  const dto: RegisterDto = {
    email: 'new@example.com',
    password: 'Correct12345',
    acceptTerms: true,
    acceptLlm: true,
  };

  it('register сохраняет consentPdAt, consentLlmAt и consentDocsVersion', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'u-new',
        companyId: null,
        createdAt: new Date(),
        ...data,
      }),
    );
    const service = makeService(prisma);

    await service.register(dto);

    const createArg = prisma.user.create.mock.calls[0]![0] as {
      data: {
        consentPdAt: Date;
        consentLlmAt: Date;
        consentDocsVersion: string;
      };
    };
    expect(createArg.data.consentPdAt).toBeInstanceOf(Date);
    expect(createArg.data.consentLlmAt).toBeInstanceOf(Date);
    // оба согласия фиксируются одним моментом времени
    expect(createArg.data.consentLlmAt).toEqual(createArg.data.consentPdAt);
    expect(createArg.data.consentDocsVersion).toBe(CONSENT_DOCS_VERSION);
  });

  it('контракт RegisterDto: без acceptTerms/acceptLlm или с false — не проходит валидацию', () => {
    expect(RegisterDtoSchema.safeParse(dto).success).toBe(true);

    const { acceptTerms: _t, ...withoutTerms } = dto;
    expect(RegisterDtoSchema.safeParse(withoutTerms).success).toBe(false);

    const { acceptLlm: _l, ...withoutLlm } = dto;
    expect(RegisterDtoSchema.safeParse(withoutLlm).success).toBe(false);

    expect(RegisterDtoSchema.safeParse({ ...dto, acceptTerms: false }).success).toBe(false);
    expect(RegisterDtoSchema.safeParse({ ...dto, acceptLlm: false }).success).toBe(false);
  });

  it('после успешной регистрации отправляется приветственное письмо (fire-and-forget)', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'u-new',
        companyId: null,
        createdAt: new Date(),
        ...data,
      }),
    );
    const mail = makeMail();
    const service = makeService(prisma, makeJwt(), mail);

    await service.register(dto);

    expect(mail.send).toHaveBeenCalledTimes(1);
    const message = mail.send.mock.calls[0]![0] as { to: string; subject: string };
    expect(message.to).toBe(dto.email);
    expect(message.subject).toContain('Добро пожаловать');
  });

  it('ошибка регистрации (EMAIL_TAKEN) — письмо не отправляется', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue(user);
    const mail = makeMail();
    const service = makeService(prisma, makeJwt(), mail);

    await expect(service.register(dto)).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
    expect(mail.send).not.toHaveBeenCalled();
  });
});

describe('AuthService — forgot-password (ADR-043)', () => {
  it('юзер есть и юзера нет — оба запроса резолвятся без ошибки (несгораемый 204)', async () => {
    const prisma = makePrisma();
    const service = makeService(prisma);

    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.forgotPassword({ email: 'ghost@example.com' })).resolves.toBeUndefined();

    prisma.user.findUnique.mockResolvedValue(user);
    await expect(service.forgotPassword({ email: user.email })).resolves.toBeUndefined();
  });

  it('юзера нет: фиктивный bcrypt-compare (timing-safe), токен не создаётся, письмо не уходит', async () => {
    const prisma = makePrisma();
    const mail = makeMail();
    const service = makeService(prisma, makeJwt(), mail);
    prisma.user.findUnique.mockResolvedValue(null);
    const compareMock = bcrypt.compare as unknown as jest.Mock;
    compareMock.mockClear();

    await service.forgotPassword({ email: 'ghost@example.com' });

    expect(compareMock).toHaveBeenCalledTimes(1);
    expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mail.send).not.toHaveBeenCalled();
  });

  it('юзер есть: старые токены инвалидируются, создаётся sha256-хэш, в письме ссылка с raw-токеном', async () => {
    const prisma = makePrisma();
    const mail = makeMail();
    const service = makeService(prisma, makeJwt(), mail);
    prisma.user.findUnique.mockResolvedValue(user);

    await service.forgotPassword({ email: user.email });

    // инвалидация прежних неиспользованных токенов
    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    // в БД — sha256-хэш, в письме — raw-токен из той же пары
    const createArg = prisma.passwordResetToken.create.mock.calls[0]![0] as {
      data: { tokenHash: string; expiresAt: Date };
    };
    const message = mail.send.mock.calls[0]![0] as { to: string; text: string };
    expect(message.to).toBe(user.email);
    const tokenMatch = /token=([0-9a-f]{64})/.exec(message.text);
    expect(tokenMatch).not.toBeNull();
    expect(createArg.data.tokenHash).toBe(sha256(tokenMatch![1]!));
    // TTL ≈ 1 час
    expect(createArg.data.expiresAt.getTime() - Date.now()).toBeGreaterThan(55 * 60 * 1000);
    expect(createArg.data.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

describe('AuthService — reset-password (ADR-043)', () => {
  const validStored = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'prt1',
    userId: 'u1',
    tokenHash: sha256('raw-reset-token'),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    usedAt: null,
    createdAt: new Date(),
    ...over,
  });

  it('успех: пароль перехэширован, токен погашен, ВСЕ refresh-токены ревокованы', async () => {
    const prisma = makePrisma();
    prisma.passwordResetToken.findUnique.mockResolvedValue(validStored());
    const service = makeService(prisma);

    await service.resetPassword({ token: 'raw-reset-token', password: 'NewPassword123' });

    const userUpdate = prisma.user.update.mock.calls[0]![0] as {
      where: { id: string };
      data: { passwordHash: string };
    };
    expect(userUpdate.where.id).toBe('u1');
    expect(userUpdate.data.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare('NewPassword123', userUpdate.data.passwordHash)).toBe(true);

    expect(prisma.passwordResetToken.update).toHaveBeenCalledWith({
      where: { id: 'prt1' },
      data: { usedAt: expect.any(Date) },
    });
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it.each([
    ['несуществующий токен', null],
    ['использованный токен', { usedAt: new Date() }],
    ['истёкший токен', { expiresAt: new Date(Date.now() - 1000) }],
  ])('%s → 422 INVALID_TOKEN с единым сообщением, пароль не меняется', async (_label, over) => {
    const prisma = makePrisma();
    prisma.passwordResetToken.findUnique.mockResolvedValue(over === null ? null : validStored(over));
    const service = makeService(prisma);

    const err = await service
      .resetPassword({ token: 'raw-reset-token', password: 'NewPassword123' })
      .catch((e: AppException) => e);

    expect(err).toBeInstanceOf(AppException);
    expect((err as AppException).code).toBe('INVALID_TOKEN');
    expect((err as AppException).getStatus()).toBe(422);
    expect((err as AppException).message).toBe('Ссылка устарела или уже использована');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });
});
