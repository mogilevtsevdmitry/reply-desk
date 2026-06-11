import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Niche, ReviewSource, ToneOfVoice } from '@replydesk/contracts';

/**
 * Сборка system/user-промптов строго по контракту prompts/README.md (ADR-015):
 * base → ниша → секция площадки (маркеры `## {ReviewSource}`) → fake-detection
 * → блок тона → блок кандидатов; нейтрализация `</review>` в rawText.
 */

/** Кандидат похожего отзыва (результат pg_trgm-поиска, шаг 2 пайплайна). */
export interface SimilarCandidate {
  id: string;
  rawText: string;
  category: string | null;
  createdAt: Date;
}

export interface BuildSystemPromptOptions {
  promptsDir: string;
  niche: Niche;
  source: ReviewSource;
  companyName: string;
  toneOfVoice: ToneOfVoice;
  candidates: SimilarCandidate[];
}

export interface BuildUserPromptOptions {
  source: ReviewSource;
  rating: number | null;
  /** Имя клиента из формы (опционально); в логи не пишется, как и rawText. */
  authorName: string | null;
  rawText: string;
}

/** Усечение текста кандидата в блоке похожих (~500 символов по README). */
const CANDIDATE_TEXT_LIMIT = 500;

/** Подписи тонов по COPY.md; значение контракта premium → подпись «уверенный» (ADR-021). */
const TONE_LABELS: Record<ToneOfVoice['tone'], string> = {
  soft: 'мягкий',
  neutral: 'нейтральный',
  premium: 'уверенный',
};

const fileCache = new Map<string, string>();

function readPromptFile(path: string): string {
  const cached = fileCache.get(path);
  if (cached !== undefined) return cached;
  const content = readFileSync(path, 'utf8');
  fileCache.set(path, content);
  return content;
}

/**
 * Поиск папки промптов: явный путь (env PROMPTS_DIR) или подъём вверх
 * от cwd и от __dirname до первого каталога с prompts/base.md
 * (работает и из apps/api, и из корня монорепо, и из dist).
 */
export function resolvePromptsDir(explicit?: string): string {
  if (explicit) {
    const dir = resolve(explicit);
    if (existsSync(join(dir, 'base.md'))) return dir;
    throw new Error(`PROMPTS_DIR указывает на каталог без base.md: ${dir}`);
  }
  for (const start of [process.cwd(), __dirname]) {
    let current = resolve(start);
    for (let i = 0; i < 8; i += 1) {
      const candidate = join(current, 'prompts');
      if (existsSync(join(candidate, 'base.md'))) return candidate;
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error('Не найдена папка prompts/ (base.md) — задайте PROMPTS_DIR');
}

/**
 * Вырезает из platforms.md преамбулу (текст до первого `## `) и секцию площадки:
 * от маркера `## {source}` до следующего `## ` или конца файла (ADR-015).
 */
export function extractPlatformSection(platformsMd: string, source: ReviewSource): string {
  const headerRe = /^## .*$/gm;
  const headers = [...platformsMd.matchAll(headerRe)];
  const firstHeaderIdx = headers[0]?.index ?? platformsMd.length;
  const preamble = platformsMd.slice(0, firstHeaderIdx).trim();

  const marker = headers.find((m) => m[0].trim() === `## ${source}`);
  if (!marker || marker.index === undefined) {
    throw new Error(`В platforms.md нет секции "## ${source}" (контракт ADR-015)`);
  }
  const next = headers.find((m) => (m.index ?? 0) > (marker.index ?? 0));
  const sectionEnd = next?.index ?? platformsMd.length;
  const section = platformsMd.slice(marker.index, sectionEnd).trim();

  return preamble ? `${preamble}\n\n${section}` : section;
}

/** Блок тона компании (п.5 контракта). Пустые avoid/examples опускаются, заголовок остаётся. */
export function buildToneBlock(companyName: string, tone: ToneOfVoice): string {
  const lines = [
    '# Компания',
    '',
    `Название: ${companyName}`,
    `Тон бренда по умолчанию: ${tone.tone} (${TONE_LABELS[tone.tone]})`,
  ];
  if (tone.avoid && tone.avoid.trim() !== '') {
    lines.push(`Чего избегать в ответах (требование владельца): ${tone.avoid.trim()}`);
  }
  if (tone.examples.length > 0) {
    lines.push('', 'Примеры текстов компании (переними лексику и манеру):');
    tone.examples.forEach((example, i) => lines.push(`${i + 1}. ${example}`));
  }
  return lines.join('\n');
}

/** Блок кандидатов похожих отзывов (п.6 контракта). Пустой список → блок не добавляется. */
export function buildCandidatesBlock(candidates: SimilarCandidate[]): string | null {
  if (candidates.length === 0) return null;
  const lines = [
    '# Кандидаты похожих отзывов этой компании',
    '',
    'Сравни по смыслу жалобы (правила — в блоке «Классификация»).',
  ];
  for (const c of candidates) {
    const date = c.createdAt.toISOString().slice(0, 10);
    const text =
      c.rawText.length > CANDIDATE_TEXT_LIMIT
        ? `${c.rawText.slice(0, CANDIDATE_TEXT_LIMIT)}…`
        : c.rawText;
    lines.push(`- id: ${c.id} | дата: ${date} | категория: ${c.category ?? '—'}`);
    lines.push(`  текст: ${text}`);
  }
  return lines.join('\n');
}

/** System-промпт: 6 частей в зафиксированном порядке, разделитель — пустая строка. */
export function buildSystemPrompt(opts: BuildSystemPromptOptions): string {
  const base = readPromptFile(join(opts.promptsDir, 'base.md'));
  const niche = readPromptFile(join(opts.promptsDir, 'niches', `${opts.niche.toLowerCase()}.md`));
  const platforms = readPromptFile(join(opts.promptsDir, 'platforms.md'));
  const fakeDetection = readPromptFile(join(opts.promptsDir, 'fake-detection.md'));

  const parts: Array<string | null> = [
    base.trim(),
    niche.trim(),
    extractPlatformSection(platforms, opts.source),
    fakeDetection.trim(),
    buildToneBlock(opts.companyName, opts.toneOfVoice),
    buildCandidatesBlock(opts.candidates),
  ];
  return parts.filter((p): p is string => p !== null).join('\n\n');
}

/**
 * User-сообщение. Нейтрализация `</review>` внутри rawText (замена на `<\/review>`),
 * чтобы текст отзыва не мог закрыть разделитель (ADR-015).
 */
export function buildUserPrompt(opts: BuildUserPromptOptions): string {
  const safeText = opts.rawText.replace(/<\/review>/gi, '<\\/review>');
  const lines = [`Площадка: ${opts.source}`];
  if (opts.rating !== null) {
    lines.push(`Оценка клиента: ${opts.rating} из 5`);
  }
  if (opts.authorName !== null && opts.authorName.trim() !== '') {
    lines.push(`Имя клиента: ${opts.authorName.trim()}`);
  }
  lines.push('', '<review>', safeText, '</review>');
  return lines.join('\n');
}
