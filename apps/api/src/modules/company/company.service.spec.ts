import type { Company, Prisma } from '@prisma/client';
import type { CreateCompanyDto } from '@replydesk/contracts';
import { AppException } from '../../common/app.exception';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuthService } from '../auth/auth.service';
import type { UsageService } from '../usage/usage.service';
import { CompanyService } from './company.service';

/** Тесты онбординга: перевыпуск access-токена с companyId (ADR-005) и 409 при повторе. */

const dto: CreateCompanyDto = {
  name: 'Салон «Лилия»',
  niche: 'SALON',
  toneOfVoice: { tone: 'soft', examples: [] },
};

const company: Company = {
  id: 'c1',
  name: dto.name,
  niche: 'SALON',
  plan: 'FREE',
  toneOfVoice: { tone: 'soft', examples: [] },
  createdAt: new Date('2026-06-11T00:00:00Z'),
};

interface TxMock {
  user: { findUnique: jest.Mock; update: jest.Mock };
  company: { create: jest.Mock };
}

function makeTx(existingCompanyId: string | null): TxMock {
  return {
    user: {
      findUnique: jest.fn(async () => ({
        id: 'u1',
        email: 'owner@example.com',
        passwordHash: 'x',
        companyId: existingCompanyId,
        createdAt: new Date(),
      })),
      update: jest.fn(),
    },
    company: { create: jest.fn(async () => company) },
  };
}

function makePrisma(tx: TxMock): PrismaService {
  return {
    $transaction: jest.fn(async (fn: (t: Prisma.TransactionClient) => Promise<unknown>) =>
      fn(tx as unknown as Prisma.TransactionClient),
    ),
    company: {
      findUnique: jest.fn(async () => company),
      update: jest.fn(async () => company),
    },
  } as unknown as PrismaService;
}

function makeAuth(): { signAccessToken: jest.Mock } {
  return {
    signAccessToken: jest.fn(
      (userId: string, companyId: string | null) => `jwt:${userId}:${companyId}`,
    ),
  };
}

function makeUsage(): UsageService {
  return {
    getUsage: jest.fn(async () => ({ used: 0, limit: 10, period: '2026-06' })),
  } as unknown as UsageService;
}

describe('CompanyService — онбординг (ADR-005)', () => {
  it('создаёт компанию и возвращает НОВЫЙ accessToken с companyId', async () => {
    const tx = makeTx(null);
    const auth = makeAuth();
    const service = new CompanyService(makePrisma(tx), auth as unknown as AuthService, makeUsage());

    const result = await service.create('u1', dto);

    expect(tx.company.create).toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { companyId: 'c1' },
    });
    // токен перевыпущен именно с companyId компании
    expect(auth.signAccessToken).toHaveBeenCalledWith('u1', 'c1');
    expect(result.accessToken).toBe('jwt:u1:c1');
    expect(result.company.id).toBe('c1');
    expect(result.company.plan).toBe('FREE');
  });

  it('повторный POST /company → 409 COMPANY_EXISTS, компания не создаётся', async () => {
    const tx = makeTx('c1'); // у юзера уже есть компания
    const auth = makeAuth();
    const service = new CompanyService(makePrisma(tx), auth as unknown as AuthService, makeUsage());

    await expect(service.create('u1', dto)).rejects.toMatchObject({ code: 'COMPANY_EXISTS' });

    try {
      await service.create('u1', dto);
    } catch (e) {
      expect((e as AppException).getStatus()).toBe(409);
    }
    expect(tx.company.create).not.toHaveBeenCalled();
    expect(auth.signAccessToken).not.toHaveBeenCalled();
  });
});

describe('CompanyService.update — редактируемая ниша (ADR-032)', () => {
  it('PATCH с niche сохраняет нишу; не переданные поля не попадают в data', async () => {
    const tx = makeTx('c1');
    const prisma = makePrisma(tx);
    const service = new CompanyService(prisma, makeAuth() as unknown as AuthService, makeUsage());

    await service.update('c1', { niche: 'HOOKAH' });

    expect(prisma.company.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { niche: 'HOOKAH' },
    });
  });
});
