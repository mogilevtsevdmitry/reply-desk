import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AccessTokenPayload } from '@replydesk/contracts';
import type { Request } from 'express';
import { AppException } from './app.exception';

export const IS_PUBLIC_KEY = 'isPublic';

/** Маркирует роут как доступный без JWT (auth, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Аутентифицированный субъект запроса (из access-JWT). */
export interface AuthUser {
  userId: string;
  companyId: string | null;
}

export interface RequestWithUser extends Request {
  authUser?: AuthUser;
}

export function payloadToAuthUser(payload: AccessTokenPayload): AuthUser {
  return { userId: payload.sub, companyId: payload.companyId };
}

/** @CurrentUser() — { userId, companyId } из JWT. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!req.authUser) {
    throw new AppException('UNAUTHORIZED', 'Требуется авторизация', 401);
  }
  return req.authUser;
});

/**
 * @CurrentCompanyId() — companyId тенанта из JWT.
 * Главное правило изоляции: каждый запрос к данным тенанта фильтруется по этому id.
 * 403, если онбординг ещё не пройден (companyId = null, ADR-005).
 */
export const CurrentCompanyId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<RequestWithUser>();
  if (!req.authUser) {
    throw new AppException('UNAUTHORIZED', 'Требуется авторизация', 401);
  }
  if (!req.authUser.companyId) {
    throw new AppException('COMPANY_NOT_FOUND', 'Сначала завершите онбординг компании', 403);
  }
  return req.authUser.companyId;
});
