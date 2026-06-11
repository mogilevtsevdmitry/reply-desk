/**
 * Юридические документы (apps/web/content/legal/*.md) — чтение на сервере (RSC).
 * Файлы статичны, читаются на этапе build (generateStaticParams по 4 slug'ам).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface LegalDoc {
  slug: string;
  title: string;
  version: string;
  /** Дата редакции в формате DD.MM.YYYY (frontmatter `updated: YYYY-MM-DD`). */
  updated: string;
  /** Markdown-тело без frontmatter, дублирующего H1 и строки «Редакция…». */
  body: string;
}

export const LEGAL_SLUGS = [
  'privacy-policy',
  'terms-of-service',
  'consent-pd',
  'consent-llm',
] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

const CONTENT_DIR = path.join(process.cwd(), 'content', 'legal');

function isLegalSlug(slug: string): slug is LegalSlug {
  return (LEGAL_SLUGS as readonly string[]).includes(slug);
}

/** YYYY-MM-DD → DD.MM.YYYY (как в шапке документов). */
function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

/**
 * Парсинг простого frontmatter (title/version/updated) без зависимостей.
 * Возвращает null для незнакомого slug или отсутствующего файла → 404 в роуте.
 */
export function readLegalDoc(slug: string): LegalDoc | null {
  if (!isLegalSlug(slug)) return null;
  const file = path.join(CONTENT_DIR, `${slug}.md`);
  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, 'utf8');
  const fmMatch = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const fmBlock = fmMatch?.[1];
  if (!fmMatch || fmBlock === undefined) return null;

  const fm = new Map<string, string>();
  for (const line of fmBlock.split('\n')) {
    const kv = /^(\w[\w-]*):\s*(.+)$/.exec(line.trim());
    const key = kv?.[1];
    const value = kv?.[2];
    if (key !== undefined && value !== undefined) fm.set(key, value.trim());
  }
  const title = fm.get('title');
  const version = fm.get('version');
  const updated = fm.get('updated');
  if (!title || !version || !updated) return null;

  // Тело без frontmatter; убираем первый H1 и строку «**Редакция …**» —
  // они дублируют шапку страницы (title + «Редакция {version} от {updated}»).
  const body = raw
    .slice(fmMatch[0].length)
    .replace(/^\s*# .+\n/, '')
    .replace(/^\s*\*\*Редакция[^\n]*\*\*\n/, '')
    .trim();

  return { slug, title, version, updated: formatDate(updated), body };
}
