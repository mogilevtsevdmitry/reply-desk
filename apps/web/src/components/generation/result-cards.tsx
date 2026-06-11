'use client';

import type { GenerationPayload, ReviewSource } from '@replydesk/contracts';
import { useQueries } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getReview } from '@/lib/api/endpoints';
import { copy, repeatTitle, resultMeta } from '@/lib/copy';
import { formatDateTime, formatDay } from '@/lib/format';
import { useReducedMotion } from '@/lib/hooks';
import { categoryLabels, sourceLabels, sourceReplyNotes } from '@/lib/labels';
import { SourceReviewCard, type SourceReviewData } from '../review/source-review-card';
import { CopyButton } from '../ui/copy-button';
import { SevComb } from '../ui/sev-comb';

type ToneKey = 'soft' | 'neutral' | 'confident';

const TONE_TABS: ReadonlyArray<{ key: ToneKey; label: string }> = [
  { key: 'soft', label: copy.cardReplyTabSoft },
  { key: 'neutral', label: copy.cardReplyTabNeutral },
  { key: 'confident', label: copy.cardReplyTabConfident },
];

/** Стаггер появления карточек: 80/190/300/410 мс (MOTION.md). */
const STAGGER_MS = [80, 190, 300, 410];

/**
 * Четыре карточки результата (прототип screen-generate.html).
 * Тексты генераций рендерятся ТОЛЬКО как текст (React-экранирование,
 * без dangerouslySetInnerHTML).
 */
export function ResultCards({
  payload,
  source,
  createdAt,
  review,
  animate = true,
}: {
  payload: GenerationPayload;
  source: ReviewSource;
  createdAt: string;
  /** Исходный отзыв клиента — блок над карточками (если передан). */
  review?: SourceReviewData;
  animate?: boolean;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState<boolean[]>(() =>
    animate ? [false, false, false, false] : [true, true, true, true],
  );

  useEffect(() => {
    if (!animate || reduced) {
      setShown([true, true, true, true]);
      return;
    }
    const timers = STAGGER_MS.map((ms, i) =>
      setTimeout(() => setShown((prev) => prev.map((v, j) => (j === i ? true : v))), ms),
    );
    return () => timers.forEach(clearTimeout);
  }, [animate, reduced]);

  const cardClass = (i: number): string => `result-card ${shown[i] ? 'is-in' : ''}`;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="m-0 font-display text-28 leading-tight font-normal">{copy.resultTitle}</h2>
        <div className="text-13 text-ink-muted">
          {resultMeta(sourceLabels[source], formatDateTime(createdAt))}
        </div>
      </div>

      {review ? <SourceReviewCard review={review} /> : null}

      <div className="grid grid-cols-1 gap-4 min-[881px]:grid-cols-2">
        <PublicReplyCard payload={payload} source={source} className={cardClass(0)} />
        <InternalTaskCard payload={payload} className={cardClass(1)} />
        <ClassificationCard payload={payload} className={cardClass(2)} />
        <WinbackCard payload={payload} className={cardClass(3)} />
      </div>
    </section>
  );
}

function Card({
  title,
  note,
  className,
  children,
}: {
  title: string;
  note?: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <article className={`${className} rounded-lg border border-line bg-surface p-6 shadow-2`}>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="m-0 font-display text-22 leading-tight font-normal">{title}</h3>
        {note ? <span className="text-12 text-ink-faint">{note}</span> : null}
      </div>
      {children}
    </article>
  );
}

// ---------- Карточка 1: Публичный ответ ----------

function PublicReplyCard({
  payload,
  source,
  className,
}: {
  payload: GenerationPayload;
  source: ReviewSource;
  className: string;
}) {
  const [tone, setTone] = useState<ToneKey>('neutral');
  const text = payload.publicReplies[tone];

  return (
    <Card title={copy.cardReplyTitle} note={sourceReplyNotes[source]} className={className}>
      <div
        role="tablist"
        aria-label={copy.cardReplyTabsAria}
        className="mb-3 inline-flex gap-[2px] rounded-md border border-line bg-bg p-[3px]"
      >
        {TONE_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tone === t.key}
            type="button"
            onClick={() => setTone(t.key)}
            className={`cursor-pointer rounded-sm border-0 px-3 py-[7px] font-text text-13 font-medium transition-colors duration-[120ms] ${
              tone === t.key ? 'bg-surface-2 text-ink shadow-1' : 'bg-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="m-0 mb-4 text-14 leading-loose whitespace-pre-line text-ink">{text}</p>
      <CopyButton label={copy.cardReplyCopy} getText={() => payload.publicReplies[tone]} />
    </Card>
  );
}

// ---------- Карточка 2: Внутренняя задача ----------

function InternalTaskCard({
  payload,
  className,
}: {
  payload: GenerationPayload;
  className: string;
}) {
  const task = payload.internalTask;
  const rows: ReadonlyArray<[string, string]> = [
    [copy.cardTaskWhat, task.what],
    [copy.cardTaskCause, task.probableCause],
    [copy.cardTaskCheck, task.toCheck.join('; ')],
    [copy.cardTaskAssignee, task.assigneeRole],
  ];

  const flatText = (): string =>
    `${copy.cardTaskWhat}: ${task.what}. ${copy.cardTaskCause}: ${task.probableCause}. ${copy.cardTaskCheck}: ${task.toCheck.join('; ')}. ${copy.cardTaskAssignee}: ${task.assigneeRole}.`;

  return (
    <Card title={copy.cardTaskTitle} className={className}>
      <dl className="m-0 mb-4 flex flex-col gap-3">
        {rows.map(([dt, dd]) => (
          <div key={dt} className="grid grid-cols-1 gap-0.5 text-14 min-[881px]:grid-cols-[92px_1fr] min-[881px]:gap-3">
            <dt className="m-0 text-ink-faint">{dt}</dt>
            <dd className="m-0 text-ink">{dd}</dd>
          </div>
        ))}
      </dl>
      <CopyButton label={copy.cardTaskCopy} getText={flatText} />
    </Card>
  );
}

// ---------- Карточка 3: Классификация ----------

function ClassificationCard({
  payload,
  className,
}: {
  payload: GenerationPayload;
  className: string;
}) {
  const cls = payload.classification;
  const similarIds = cls.similarReviewIds;

  // Даты похожих отзывов для ссылок «Похожие: 28 мая, 5 июня»
  const similarQueries = useQueries({
    queries: similarIds.map((id) => ({
      queryKey: ['reviews', id] as const,
      queryFn: () => getReview(id),
      staleTime: 5 * 60_000,
    })),
  });

  return (
    <Card title={copy.cardClsTitle} className={className}>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <span className="inline-block rounded-pill border border-line-strong px-3 py-1.5 text-13 text-ink">
          {categoryLabels[cls.category]}
        </span>
        <SevComb level={cls.severity} withWord numClass="text-18" />
      </div>

      {/* Повторяемость */}
      <div className="mb-3 rounded-md border border-line px-4 py-3 text-14">
        {cls.isRepeat && similarIds.length > 0 ? (
          <>
            <b className="font-semibold text-sev-3">{repeatTitle(similarIds.length + 1)}</b>
            <div className="mt-1 text-13">
              {copy.repeatLinksLabel}{' '}
              {similarIds.map((id, i) => {
                const review = similarQueries[i]?.data;
                return (
                  <span key={id}>
                    {i > 0 ? ', ' : ''}
                    <Link href={`/app/reviews/${id}`} className="text-accent hover:underline">
                      {review ? formatDay(review.createdAt) : '…'}
                    </Link>
                  </span>
                );
              })}
            </div>
          </>
        ) : (
          <span className="text-ink-muted">{copy.repeatNone}</span>
        )}
      </div>

      {/* Флаг заказного отзыва — предположение, не обвинение */}
      <div className="rounded-md border border-dashed border-line px-4 py-3 text-14 text-ink-muted">
        <span className="mb-0.5 block font-medium text-ink">
          {cls.fakeSuspicion.flag ? copy.fakeTitleSuspected : copy.fakeTitleClear}
        </span>
        {cls.fakeSuspicion.reason}
        <span className="mt-1 block text-12 text-ink-faint">{copy.fakeFoot}</span>
      </div>
    </Card>
  );
}

// ---------- Карточка 4: Возврат клиента ----------

function WinbackCard({ payload, className }: { payload: GenerationPayload; className: string }) {
  const winback = payload.winback;
  return (
    <Card title={copy.cardWinbackTitle} className={className}>
      <p className="m-0 mb-4 text-14 leading-loose whitespace-pre-line text-ink">
        {winback.message}
      </p>
      <div className="mb-4 rounded-md bg-bg px-4 py-3 text-14">
        <span className="mb-0.5 block text-12 tracking-caps text-ink-faint uppercase">
          {copy.cardWinbackCompLabel}
        </span>
        {winback.compensation.type}. {winback.compensation.rationale}
      </div>
      {/* Копируется только личное сообщение, без рекомендации */}
      <CopyButton label={copy.cardWinbackCopy} getText={() => winback.message} />
    </Card>
  );
}
