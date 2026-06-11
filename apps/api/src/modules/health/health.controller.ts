import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { Public } from '../../common/decorators';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS } from '../../redis/redis.module';

interface HealthReport {
  status: 'ok' | 'degraded';
  checks: {
    postgres: 'up' | 'down';
    redis: 'up' | 'down';
  };
}

/** GET /api/v1/health — liveness (ответ 200/503) + readiness (ping postgres и redis). */
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async health(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const [postgres, redis] = await Promise.all([this.checkPostgres(), this.checkRedis()]);
    const ok = postgres === 'up' && redis === 'up';
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', checks: { postgres, redis } };
  }

  private async checkPostgres(): Promise<'up' | 'down'> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down'> {
    try {
      const pong = await this.redis.ping();
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
