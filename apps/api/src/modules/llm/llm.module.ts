import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFileSync } from 'node:child_process';
import type { Env } from '../../config/env';
import { AnthropicProvider } from './anthropic.provider';
import { ClaudeCliProvider } from './claude-cli.provider';
import { FakeLlmProvider } from './fake-llm.provider';
import { LLM_PROVIDER, LlmProvider } from './llm.types';

/** Есть ли в PATH бинарь claude (Claude Code CLI). Используется только при LLM_PROVIDER=auto. */
function isClaudeCliAvailable(): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * LLM-слой за DI-токеном LLM_PROVIDER (docs/02-DEVELOPER.md, раздел 3).
 * Реализация выбирается по env LLM_PROVIDER:
 * auto (дефолт, ADR-034) — есть ANTHROPIC_API_KEY → anthropic, иначе claude-cli;
 * anthropic (прод) | fake (dev/QA, ADR-019) | claude-cli (dev-only, ADR-031).
 */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): LlmProvider => {
        const logger = new Logger('LlmModule');
        const provider = config.get('LLM_PROVIDER', { infer: true });
        const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });

        if (provider === 'fake') {
          logger.log('LLM-провайдер: fake (LLM_PROVIDER=fake)');
          return new FakeLlmProvider();
        }
        if (provider === 'claude-cli') {
          logger.log('LLM-провайдер: claude-cli (LLM_PROVIDER=claude-cli)');
          return new ClaudeCliProvider(config.get('CLAUDE_CLI_MODEL', { infer: true }));
        }
        if (provider === 'anthropic') {
          if (!apiKey) {
            throw new Error('ANTHROPIC_API_KEY обязателен при LLM_PROVIDER=anthropic');
          }
          logger.log('LLM-провайдер: anthropic (LLM_PROVIDER=anthropic)');
          return new AnthropicProvider({
            apiKey,
            model: config.get('ANTHROPIC_MODEL', { infer: true }),
          });
        }

        // auto (ADR-034): ключ есть → anthropic, иначе локальный claude-cli.
        if (apiKey) {
          logger.log('LLM-провайдер: anthropic (LLM_PROVIDER=auto, найден ANTHROPIC_API_KEY)');
          return new AnthropicProvider({
            apiKey,
            model: config.get('ANTHROPIC_MODEL', { infer: true }),
          });
        }
        if (!isClaudeCliAvailable()) {
          throw new Error(
            'LLM_PROVIDER=auto: нет ANTHROPIC_API_KEY и claude CLI недоступен. ' +
              'Задайте ANTHROPIC_API_KEY (прод) или установите Claude Code CLI (dev), ' +
              'либо укажите LLM_PROVIDER=fake для работы без LLM.',
          );
        }
        logger.log(
          'LLM-провайдер: claude-cli (LLM_PROVIDER=auto, ANTHROPIC_API_KEY не задан, claude CLI найден)',
        );
        return new ClaudeCliProvider(config.get('CLAUDE_CLI_MODEL', { infer: true }));
      },
    },
  ],
  exports: [LLM_PROVIDER],
})
export class LlmModule {}
