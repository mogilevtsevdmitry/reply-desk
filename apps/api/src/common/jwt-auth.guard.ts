import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayloadSchema } from '@replydesk/contracts';
import { AppException } from './app.exception';
import { IS_PUBLIC_KEY, payloadToAuthUser, RequestWithUser } from './decorators';

/** Глобальный JWT-guard. Роуты без токена помечаются @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) {
      throw new AppException('UNAUTHORIZED', 'Требуется авторизация', 401);
    }

    try {
      const raw = await this.jwtService.verifyAsync<Record<string, unknown>>(token);
      const payload = AccessTokenPayloadSchema.parse(raw);
      req.authUser = payloadToAuthUser(payload);
      return true;
    } catch {
      throw new AppException('UNAUTHORIZED', 'Недействительный или истёкший токен', 401);
    }
  }
}
