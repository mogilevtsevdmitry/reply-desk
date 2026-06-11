import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import type { AccessTokenPayload, LoginDto, RegisterDto, UserDto } from '@replydesk/contracts';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AppException } from '../../common/app.exception';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';

export const BCRYPT_COST = 12;

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const INVALID_CREDENTIALS_MESSAGE = 'Неверный email или пароль';

@Injectable()
export class AuthService {
  /**
   * Фиктивный хэш для bcrypt-compare при отсутствии пользователя:
   * время ответа login не выдаёт, существует ли email (timing-атака).
   */
  private readonly dummyHash: string = bcrypt.hashSync(randomBytes(24).toString('hex'), BCRYPT_COST);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async register(dto: RegisterDto): Promise<UserDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new AppException('EMAIL_TAKEN', 'Этот email уже зарегистрирован', 409);
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash },
    });
    return this.toUserDto(user);
  }

  async login(dto: LoginDto): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Единое сообщение об ошибке + фиктивное сравнение при отсутствии пользователя.
    const passwordOk = await bcrypt.compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !passwordOk) {
      throw new AppException('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE, 401);
    }

    return this.issueTokens(user.id, user.companyId);
  }

  /**
   * Ротация refresh-токена (ADR-016: opaque-токен, в БД — sha256-хэш).
   * Повторное использование уже ревокованного токена — признак кражи:
   * ревокация ВСЕХ refresh-токенов пользователя.
   */
  async refresh(rawRefreshToken: string): Promise<IssuedTokens> {
    const tokenHash = this.hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      throw new AppException('UNAUTHORIZED', 'Сессия недействительна, войдите заново', 401);
    }

    if (stored.revokedAt) {
      // Детект повторного использования → ревокация всей семьи токенов пользователя.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AppException('UNAUTHORIZED', 'Сессия недействительна, войдите заново', 401);
    }

    if (stored.expiresAt <= new Date()) {
      throw new AppException('UNAUTHORIZED', 'Сессия истекла, войдите заново', 401);
    }

    // Ротация: старый токен ревокуется, выпускается новая пара.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    // companyId берём из БД: после онбординга refresh выдаёт актуальный токен (ADR-005).
    return this.issueTokens(stored.user.id, stored.user.companyId);
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: this.hashToken(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Подписывает access-JWT { sub, companyId }. Используется и CompanyService (ADR-005). */
  signAccessToken(userId: string, companyId: string | null): string {
    const payload: AccessTokenPayload = { sub: userId, companyId };
    return this.jwtService.sign(payload);
  }

  private async issueTokens(userId: string, companyId: string | null): Promise<IssuedTokens> {
    const refreshToken = randomBytes(48).toString('hex');
    const ttlDays = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    const refreshExpiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      accessToken: this.signAccessToken(userId, companyId),
      refreshToken,
      refreshExpiresAt,
    };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private toUserDto(user: User): UserDto {
    return {
      id: user.id,
      email: user.email,
      companyId: user.companyId,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
