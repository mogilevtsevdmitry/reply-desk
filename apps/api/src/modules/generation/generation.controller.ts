import { Controller, Get, Inject, Param, Req, Res } from '@nestjs/common';
import type { Generation } from '@prisma/client';
import {
  GenerationEvent,
  GenerationEventSchema,
  GenerationPayload,
  GenerationPayloadSchema,
} from '@replydesk/contracts';
import type { Request, Response } from 'express';
import type { Redis } from 'ioredis';
import { AppException } from '../../common/app.exception';
import { CurrentCompanyId } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';
import { genChannel, isFinalStatus } from './generation.events';

/** Keep-alive комментарии SSE (ТЗ: каждые 15с). */
const KEEP_ALIVE_MS = 15_000;

/** Generic-текст для реконнекта к уже удалённой FAILED-генерации (ADR-042). */
const GENERIC_GENERATION_ERROR =
  'Внутренняя ошибка генерации. Попробуйте повторить генерацию.';

/**
 * SSE-поток статусов генерации (ADR-004: аутентификация — Authorization-заголовок,
 * глобальный JwtAuthGuard; токен в query запрещён).
 *
 * Порядок против потери событий: проверка тенанта → подписка на gen:{id} →
 * немедленная отдача текущего статуса из БД → трансляция pub/sub до финального события.
 */
@Controller('generations')
export class GenerationController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get(':id/events')
  async events(
    @CurrentCompanyId() companyId: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // Принадлежность генерации тенанту проверяется ДО подписки; чужой/несуществующий id → 404.
    const owned = await this.prisma.generation.findFirst({
      where: { id, review: { companyId } },
      select: { id: true },
    });
    if (!owned) {
      throw new AppException('NOT_FOUND', 'Генерация не найдена', 404);
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const subscriber = this.redis.duplicate();
    let closed = false;

    const keepAlive = setInterval(() => {
      if (!closed) res.write(': keep-alive\n\n');
    }, KEEP_ALIVE_MS);

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(keepAlive);
      void subscriber.quit().catch(() => undefined);
      res.end();
    };

    const send = (event: GenerationEvent): void => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
      if (isFinalStatus(event.status)) cleanup();
    };

    req.on('close', cleanup);

    // 1. Подписка ДО чтения статуса — события между чтением и подпиской не теряются.
    await subscriber.subscribe(genChannel(id));
    subscriber.on('message', (_channel, message) => {
      const parsed = GenerationEventSchema.safeParse(this.tryJson(message));
      if (parsed.success) send(parsed.data);
    });

    // 2. Немедленная отдача текущего статуса из БД (включая финальный, если уже готов).
    // ADR-042: упавшая генерация удаляется воркером после публикации FAILED.
    // Если запись исчезла между проверкой тенанта и чтением статуса (реконнект
    // после удаления) — отдаём финальное FAILED с generic-текстом, поток закрывается.
    const generation = await this.prisma.generation.findUnique({ where: { id } });
    if (generation) {
      send(this.toEvent(generation));
    } else {
      send({ status: 'FAILED', error: GENERIC_GENERATION_ERROR });
    }
  }

  private toEvent(generation: Generation): GenerationEvent {
    if (generation.status === 'DONE') {
      const payload = this.toPayload(generation);
      return payload ? { status: 'DONE', payload } : { status: 'DONE' };
    }
    if (generation.status === 'FAILED') {
      return { status: 'FAILED', error: generation.error ?? 'Ошибка генерации' };
    }
    return { status: generation.status };
  }

  private toPayload(generation: Generation): GenerationPayload | undefined {
    const parsed = GenerationPayloadSchema.safeParse({
      publicReplies: generation.publicReplies,
      internalTask: generation.internalTask,
      classification: generation.classification,
      winback: generation.winback,
    });
    return parsed.success ? parsed.data : undefined;
  }

  private tryJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
