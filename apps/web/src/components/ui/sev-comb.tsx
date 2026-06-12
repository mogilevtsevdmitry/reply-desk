import { severityAria, severityWords } from '@/lib/copy';

const SEV_TEXT: Record<number, string> = {
  1: 'text-sev-1',
  2: 'text-sev-2',
  3: 'text-sev-3',
  4: 'text-sev-4',
  5: 'text-sev-5',
};
const SEV_BG: Record<number, string> = {
  1: 'bg-sev-1',
  2: 'bg-sev-2',
  3: 'bg-sev-3',
  4: 'bg-sev-4',
  5: 'bg-sev-5',
};
const HEIGHTS = ['h-[6px]', 'h-[10px]', 'h-[14px]', 'h-[18px]', 'h-[22px]'];

/**
 * Severity-«сейсмограмма»: гребёнка из 5 столбиков + цифра (+ словесная метка).
 * level = 0 — пустая гребёнка (severity ещё не присвоен — генерация в полёте).
 */
export function SevComb({
  level,
  withWord = false,
  numClass = 'text-16',
}: {
  level: number;
  withWord?: boolean;
  numClass?: string;
}) {
  const word = severityWords[level] ?? '';
  return (
    <span
      className="inline-flex items-center gap-2"
      aria-label={level >= 1 && level <= 5 ? severityAria(level, word) : undefined}
      aria-hidden={level < 1 || level > 5 ? true : undefined}
    >
      <span className="inline-flex h-[22px] items-end gap-[3px]" aria-hidden="true">
        {HEIGHTS.map((h, i) => (
          <i
            key={i}
            className={`w-[4px] rounded-[2px] ${h} ${i < level ? SEV_BG[level] : 'bg-line-strong'}`}
          />
        ))}
      </span>
      {level >= 1 && level <= 5 ? (
        <>
          <span className={`font-display ${numClass} ${SEV_TEXT[level]}`} aria-hidden="true">
            {level}
          </span>
          {withWord ? (
            <span className="text-13 text-ink-muted" aria-hidden="true">
              {word}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  );
}
