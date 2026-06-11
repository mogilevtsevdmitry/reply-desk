import { Injectable } from '@nestjs/common';
import type { Company, Prisma } from '@prisma/client';
import {
  CompanyDto,
  CreateCompanyDto,
  CreateCompanyResponse,
  ToneOfVoiceSchema,
  UpdateCompanyDto,
} from '@replydesk/contracts';
import { AppException } from '../../common/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class CompanyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Онбординг: создаётся один раз (409 при повторе).
   * Возвращает НОВЫЙ access-токен с companyId (ADR-005) — токен регистрации
   * содержит companyId=null и не даёт доступа к данным тенанта.
   */
  async create(userId: string, dto: CreateCompanyDto): Promise<CreateCompanyResponse> {
    const company = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new AppException('UNAUTHORIZED', 'Требуется авторизация', 401);
      }
      if (user.companyId) {
        throw new AppException('COMPANY_EXISTS', 'Компания уже создана', 409);
      }
      const created = await tx.company.create({
        data: {
          name: dto.name,
          niche: dto.niche,
          toneOfVoice: dto.toneOfVoice as Prisma.InputJsonObject,
        },
      });
      await tx.user.update({ where: { id: userId }, data: { companyId: created.id } });
      return created;
    });

    return {
      company: this.toCompanyDto(company),
      accessToken: this.authService.signAccessToken(userId, company.id),
    };
  }

  /** Чтение строго по companyId из JWT — изоляция тенантов. */
  async getMe(companyId: string): Promise<CompanyDto> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new AppException('COMPANY_NOT_FOUND', 'Компания не найдена', 404);
    }
    return this.toCompanyDto(company);
  }

  async update(companyId: string, dto: UpdateCompanyDto): Promise<CompanyDto> {
    await this.getMe(companyId); // 404, если компании нет
    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.toneOfVoice !== undefined
          ? { toneOfVoice: dto.toneOfVoice as Prisma.InputJsonObject }
          : {}),
      },
    });
    return this.toCompanyDto(company);
  }

  private toCompanyDto(company: Company): CompanyDto {
    return {
      id: company.id,
      name: company.name,
      niche: company.niche,
      plan: company.plan,
      toneOfVoice: ToneOfVoiceSchema.parse(company.toneOfVoice),
      createdAt: company.createdAt.toISOString(),
    };
  }
}
