import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import type {
  AccessTokenPayload,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UserDto,
} from '@replydesk/contracts';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { AppException } from '../../common/app.exception';
import type { Env } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { passwordResetEmail, welcomeEmail } from '../mail/mail.templates';

export const BCRYPT_COST = 12;

/** TTL токена сброса пароля — 1 час (ADR-043). */
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Версия редакции юридических документов, которую принимает пользователь
 * при регистрации (apps/web/content/legal/*, frontmatter `version`).
 * При выпуске новой редакции — поднять синхронно с документами.
 */
export const CONSENT_DOCS_VERSION = 'v1.0';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const INVALID_CREDENTIALS_MESSAGE = 'Неверный email или пароль';

/** Одно сообщение на все случаи невалидного токена сброса — не раскрываем причину (ADR-043). */
const INVALID_RESET_TOKEN_MESSAGE = 'Ссылка устарела или уже использована';

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
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<UserDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new AppException('EMAIL_TAKEN', 'Этот email уже зарегистрирован', 409);
    }
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    // Фиксируем факты согласий (152-ФЗ, доказуемость): контракт гарантирует
    // acceptTerms/acceptLlm === true; время и версия документов — в БД, не в логах.
    const consentAt = new Date();
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        consentPdAt: consentAt,
        consentLlmAt: consentAt,
        consentDocsVersion: CONSENT_DOCS_VERSION,
      },
    });
    // Приветственное письмо — fire-and-forget: ошибка почты не валит регистрацию (ADR-044).
    void this.mailService.send(welcomeEmail(user.email, this.appUrl()));
    return this.toUserDto(user);
  }

  /**
   * Запрос восстановления пароля (ADR-043). Всегда «успех»: существование
   * аккаунта не раскрывается ни ответом, ни таймингом (фиктивный bcrypt-compare
   * при отсутствии пользователя — как в login).
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user) {
      // Фиктивная работа (как dummy-compare в login): время ответа не выдаёт отсутствие аккаунта.
      await bcrypt.compare(randomBytes(8).toString('hex'), this.dummyHash);
      return;
    }

    // Прежние неиспользованные токены инвалидируются: действует только последняя ссылка.
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: this.hashToken(token), expiresAt },
      }),
    ]);

    const resetUrl = `${this.appUrl()}/reset-password?token=${token}`;
    void this.mailService.send(passwordResetEmail(user.email, resetUrl));
  }

  /**
   * Сброс пароля по токену из письма (ADR-043). Любая проблема с токеном
   * (нет / использован / истёк) → 422 INVALID_TOKEN с единым сообщением.
   * Успех: новый bcrypt-хэш, токен одноразово гасится, ВСЕ refresh-токены
   * пользователя ревокуются — активные сессии разлогиниваются.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(dto.token) },
    });
    if (!stored || stored.usedAt || stored.expiresAt <= new Date()) {
      throw new AppException('INVALID_TOKEN', INVALID_RESET_TOKEN_MESSAGE, 422);
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: now },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: now },
      }),
    ]);
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

  private appUrl(): string {
    return this.config.get('APP_URL', { infer: true });
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
