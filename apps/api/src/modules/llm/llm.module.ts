import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { AnthropicProvider } from './anthropic.provider';
import { FakeLlmProvider } from './fake-llm.provider';
import { LLM_PROVIDER, LlmProvider } from './llm.types';

/**
 * LLM-слой за DI-токеном LLM_PROVIDER (docs/02-DEVELOPER.md, раздел 3).
 * Реализация выбирается по env LLM_PROVIDER: anthropic (прод) | fake (dev/QA, ADR-019).
 */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmProvider => {
        if (config.get('LLM_PROVIDER', { infer: true }) === 'fake') {
          return new FakeLlmProvider();
        }
        const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
        if (!apiKey) {
          throw new Error('ANTHROPIC_API_KEY обязателен при LLM_PROVIDER=anthropic');
        }
        return new AnthropicProvider({
          apiKey,
          model: config.get('ANTHROPIC_MODEL', { infer: true }),
        });
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
