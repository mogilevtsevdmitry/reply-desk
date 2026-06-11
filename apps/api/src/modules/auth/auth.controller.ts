import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import {
  AuthTokenResponse,
  LoginDto,
  LoginDtoSchema,
  RegisterDto,
  RegisterDtoSchema,
  RegisterResponse,
} from '@replydesk/contracts';
import type { Request, Response } from 'express';
import { AppException } from '../../common/app.exception';
import { Public } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { Env } from '../../config/env';
import { AuthService, IssuedTokens } from './auth.service';

export const REFRESH_COOKIE = 'rd_refresh';

/**
 * /auth/* — усиленный rate limit.
 * Дефолт: 10 req/60s. Переопределяется через THROTTLE_AUTH_LIMIT / THROTTLE_AUTH_TTL_MS
 * для E2E-окружения (ADR-025).
 */
const AUTH_THROTTLE_LIMIT = process.env.THROTTLE_AUTH_LIMIT
  ? parseInt(process.env.THROTTLE_AUTH_LIMIT, 10)
  : 10;
const AUTH_THROTTLE_TTL = process.env.THROTTLE_AUTH_TTL_MS
  ? parseInt(process.env.THROTTLE_AUTH_TTL_MS, 10)
  : 60_000;

@Public()
@Throttle({ default: { limit: AUTH_THROTTLE_LIMIT, ttl: AUTH_THROTTLE_TTL } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('register')
  async register(
    @Body(new ZodValidationPipe(RegisterDtoSchema)) dto: RegisterDto,
  ): Promise<RegisterResponse> {
    const user = await this.authService.register(dto);
    return { user };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(LoginDtoSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const tokens = await this.authService.login(dto);
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthTokenResponse> {
    const raw = this.readRefreshCookie(req);
    if (!raw) {
      throw new AppException('UNAUTHORIZED', 'Сессия недействительна, войдите заново', 401);
    }
    const tokens = await this.authService.refresh(raw);
    this.setRefreshCookie(res, tokens);
    return { accessToken: tokens.accessToken };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.authService.logout(this.readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  private readRefreshCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private setRefreshCookie(res: Response, tokens: IssuedTokens): void {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      path: '/api/v1/auth', // кука уходит только на auth-эндпоинты
      expires: tokens.refreshExpiresAt,
    });
  }
}
