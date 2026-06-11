import { GenerationPayload } from '@replydesk/contracts';
import {
  GenerateStructuredOptions,
  GenerateStructuredResult,
  LlmInvalidOutputError,
  LlmNetworkError,
  LlmProvider,
  LlmTimeoutError,
} from './llm.types';

/**
 * Маркеры режимов ошибок (ADR-019). Вставляются в текст отзыва — QA управляет
 * сценарием на уровне одного запроса, без перезапуска приложения.
 */
export const FAKE_LLM_MARKERS = {
  /** Невалидный JSON и после повторного запроса → LlmInvalidOutputError. */
  INVALID: '[[FAKE:INVALID]]',
  /** Таймаут вызова → LlmTimeoutError. */
  TIMEOUT: '[[FAKE:TIMEOUT]]',
  /** Сетевая ошибка после исчерпания ретраев → LlmNetworkError. */
  NETWORK: '[[FAKE:NETWORK]]',
} as const;

/** Небольшая пауза, чтобы SSE-статусы были наблюдаемы в dev/QA. */
const FAKE_LATENCY_MS = 200;

/**
 * Детерминированный провайдер без сети (env LLM_PROVIDER=fake).
 * Возвращает правдоподобный русский пакет; похожие отзывы берёт из блока
 * кандидатов system-промпта (плюс один заведомо чужой id — демонстрирует
 * серверную фильтрацию similarReviewIds).
 */
export class FakeLlmProvider implements LlmProvider {
  async generateStructured<T>(
    opts: GenerateStructuredOptions<T>,
  ): Promise<GenerateStructuredResult<T>> {
    await new Promise((resolve) => setTimeout(resolve, FAKE_LATENCY_MS));

    if (opts.user.includes(FAKE_LLM_MARKERS.INVALID)) {
      throw new LlmInvalidOutputError(
        'Ответ модели не прошёл валидацию схемы после повторного запроса (fake-режим)',
      );
    }
    if (opts.user.includes(FAKE_LLM_MARKERS.TIMEOUT)) {
      throw new LlmTimeoutError('Вызов не уложился в таймаут 60с (fake-режим)');
    }
    if (opts.user.includes(FAKE_LLM_MARKERS.NETWORK)) {
      throw new LlmNetworkError('Сетевая ошибка после исчерпания ретраев (fake-режим)');
    }

    const candidateIds = this.extractCandidateIds(opts.system);
    const payload = this.buildPayload(candidateIds);
    const parsed = opts.schema.safeParse(payload);
    if (!parsed.success) {
      throw new LlmInvalidOutputError(
        `FakeLlmProvider не умеет схему запроса: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    return { data: parsed.data, tokensUsed: 1234 };
  }

  /** Парсит id кандидатов из блока похожих отзывов system-промпта. */
  private extractCandidateIds(system: string): string[] {
    const ids: string[] = [];
    for (const match of system.matchAll(/^- id: (\S+) \|/gm)) {
      if (match[1] !== undefined) ids.push(match[1]);
    }
    return ids;
  }

  private buildPayload(candidateIds: string[]): GenerationPayload {
    const firstCandidate = candidateIds[0];
    return {
      publicReplies: {
        soft: 'Нам очень жаль, что визит прошёл не так, как вы рассчитывали. Разберёмся в ситуации и предложим, как исправить впечатление — напишите администратору, подберём удобное время.',
        neutral:
          'Спасибо, что рассказали. Проверили записи: сбой действительно был с нашей стороны. Разберёмся с расписанием и будем рады видеть вас снова.',
        confident:
          'Проверили записи по вашему визиту — расскажем, как было. Часть претензии подтвердилась, и мы уже скорректировали процесс; по остальному готовы обсудить детали лично.',
        platformNotes: 'Ответ без ссылок, телефонов и промокодов — по консервативным правилам площадки.',
      },
      internalTask: {
        what: 'Клиент недоволен визитом: описан сбой в обслуживании.',
        probableCause: 'Вероятно, накладка в расписании или нехватка персонала в смену.',
        toCheck: ['Журнал записи за день визита', 'Состав смены и загрузку мастеров', 'Переписку с клиентом при записи'],
        assigneeRole: 'Администратор',
      },
      classification: {
        category: 'SERVICE',
        severity: 3,
        isRepeat: firstCandidate !== undefined,
        // Заведомо чужой id демонстрирует фильтрацию подмножества кандидатов на сервере.
        similarReviewIds:
          firstCandidate !== undefined ? [firstCandidate, 'fake-nonexistent-id'] : [],
        fakeSuspicion: { flag: false, reason: 'Признаков заказного отзыва не обнаружено.' },
      },
      winback: {
        message:
          'Здравствуйте! Это администратор. Жаль, что визит прошёл со сбоем — хотим исправить впечатление. Подберём удобное время и встретим без ожидания.',
        compensation: {
          type: 'Скидка на повторный визит',
          rationale: 'Заметная, но соразмерная претензии компенсация: сбой подтверждён, ущерб ограничен впечатлением.',
        },
      },
    };
  }
}
