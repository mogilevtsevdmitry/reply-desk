import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { RefreshToken, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { AppException } from '../../common/app.exception';
import type { Env } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';

/** Тесты ротации refresh-токена, детекта повторного использования и login-флоу. БД мокается. */

// bcryptjs с реальной имплементацией, но compare обёрнут в jest.fn —
// чтобы проверить фиктивное сравнение при отсутствии пользователя.
jest.mock('bcryptjs', () => {
  const actual = jest.requireActual<typeof import('bcryptjs')>('bcryptjs');
  return { ...actual, compare: jest.fn(actual.compare) };
});

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

interface PrismaMock {
  user: { findUnique: jest.Mock; create: jest.Mock };
  refreshToken: {
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    updateMany: jest.Mock;
  };
}

function makePrisma(): PrismaMock {
  return {
    user: { findUnique: jest.fn(), create: jest.fn() },
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
  };
}

function makeJwt(): { sign: jest.Mock } {
  return { sign: jest.fn((payload: Record<string, unknown>) => `jwt:${JSON.stringify(payload)}`) };
}

function makeConfig(): ConfigService<Env, true> {
  const env: Partial<Env> = { REFRESH_TTL_DAYS: 30, NODE_ENV: 'test' };
  return {
    get: jest.fn((key: keyof Env) => env[key]),
  } as unknown as ConfigService<Env, true>;
}

function makeService(prisma: PrismaMock, jwt = makeJwt()): AuthService {
  return new AuthService(
    prisma as unknown as PrismaService,
    jwt as unknown as JwtService,
    makeConfig(),
  );
}

const user: User = {
  id: 'u1',
  email: 'owner@example.com',
  passwordHash: bcrypt.hashSync('Correct12345', 4), // низкий cost только для скорости тестов
  companyId: 'c1',
  createdAt: new Date('2026-06-01T00:00:00Z'),
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
