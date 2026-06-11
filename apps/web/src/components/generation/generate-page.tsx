'use client';

import {
  ReviewSourceSchema,
  type CreateReviewResponse,
  type GenerationPayload,
  type ReviewSource,
} from '@replydesk/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { NAV_REPEAT_EVENT } from '../layout/app-shell';
import { isApiError } from '@/lib/api/client';
import { createReview } from '@/lib/api/endpoints';
import { copy, genLimitNote, ratingAria } from '@/lib/copy';
import { useCompanyMe } from '@/lib/hooks';
import { sourceDotClass, sourceLabels } from '@/lib/labels';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';
import { GenerationRun } from './generation-run';
import { ResultCards } from './result-cards';

const REVIEW_MAX = 4000;

type Screen =
  | { kind: 'form' }
  | { kind: 'pipeline'; run: CreateReviewResponse; reviewText: string; source: ReviewSource }
  | {
      kind: 'result';
      payload: GenerationPayload;
      source: ReviewSource;
      createdAt: string;
    };

/** Главный экран /app: три состояния — пустое / пайплайн / результат. */
export function GeneratePage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { data: company } = useCompanyMe();
  const [screen, setScreen] = useState<Screen>({ kind: 'form' });

  const [text, setText] = useState('');
  const [source, setSource] = useState<ReviewSource>('YANDEX_MAPS');
  const [rating, setRating] = useState<number | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const usage = company?.usage;
  const remaining = usage ? Math.max(0, usage.limit - usage.used) : null;

  // Повторный клик по «Генерация» в навигации → возврат к пустой форме
  useEffect(() => {
    const onRepeat = (e: Event): void => {
      if ((e as CustomEvent).detail === '/app') {
        setScreen({ kind: 'form' });
        setText('');
        setRating(null);
        setTextError(null);
      }
    };
    window.addEventListener(NAV_REPEAT_EVENT, onRepeat);
    return () => window.removeEventListener(NAV_REPEAT_EVENT, onRepeat);
  }, []);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      setTextError(copy.errorReviewEmpty);
      return;
    }
    if (text.length > REVIEW_MAX) {
      setTextError(copy.errorReviewTooLong);
      return;
    }
    setTextError(null);
    setPending(true);
    try {
      const run = await createReview({
        source,
        rawText: trimmed,
        ...(rating !== null ? { rating } : {}),
      });
      setScreen({ kind: 'pipeline', run, reviewText: trimmed, source });
    } catch (err) {
      if (isApiError(err) && err.code === 'LIMIT_EXCEEDED') {
        router.push('/app/upgrade');
      } else if (isApiError(err) && err.code === 'NETWORK') {
        showToast(copy.errorNetwork, 'error');
      } else if (isApiError(err) && err.code === 'RATE_LIMITED') {
        showToast(copy.error429, 'error');
      } else if (isApiError(err) && err.code === 'VALIDATION_ERROR') {
        setTextError(err.message);
      } else {
        showToast(copy.errorServer, 'error');
      }
    } finally {
      setPending(false);
    }
  };

  if (screen.kind === 'pipeline') {
    return (
      <GenerationRun
        reviewId={screen.run.reviewId}
        generationId={screen.run.generationId}
        reviewText={screen.reviewText}
        onDone={(payload) =>
          setScreen({
            kind: 'result',
            payload,
            source: screen.source,
            createdAt: new Date().toISOString(),
          })
        }
      />
    );
  }

  if (screen.kind === 'result') {
    return (
      <ResultCards payload={screen.payload} source={screen.source} createdAt={screen.createdAt} />
    );
  }

  // ---------- Пустое состояние: форма ----------
  return (
    <section>
      <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal min-[881px]:text-36">
        {copy.genTitle}
      </h1>
      <p className="m-0 mb-8 text-14 text-ink-muted">{copy.genSub}</p>

      <form
        className="rounded-lg border border-line bg-surface p-6 shadow-2"
        onSubmit={(e) => void handleSubmit(e)}
        noValidate
      >
        <div className="mb-4 flex flex-col gap-1">
          <div className="flex items-baseline justify-between">
            <label htmlFor="review-text" className="text-13 font-medium text-ink-muted">
              {copy.genReviewLabel}
            </label>
            <span
              className={`text-12 ${text.length > REVIEW_MAX ? 'text-danger' : 'text-ink-faint'}`}
              aria-hidden="true"
            >
              {text.length} / {REVIEW_MAX}
            </span>
          </div>
          <textarea
            id="review-text"
            value={text}
            placeholder={copy.genReviewPlaceholder}
            aria-invalid={textError ? true : undefined}
            onChange={(e) => {
              setText(e.target.value);
              if (textError) setTextError(null);
            }}
            className={`rd-textarea min-h-[140px] w-full resize-y rounded-md border bg-bg px-3.5 py-3 font-text text-16 leading-base text-ink transition-colors duration-[120ms] placeholder:text-ink-faint hover:border-ink-faint ${
              textError ? 'border-danger' : 'border-line-strong'
            }`}
          />
          {textError ? (
            <p role="alert" className="mt-1 text-13 text-danger">
              {textError}
            </p>
          ) : null}
        </div>

        <div className="mb-6 flex flex-wrap gap-6">
          {/* Площадка */}
          <div className="flex flex-col gap-1">
            <span className="text-13 font-medium text-ink-muted" id="src-label">
              {copy.genSourceLabel}
            </span>
            <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="src-label">
              {ReviewSourceSchema.options.map((s) => (
                <label key={s} className="relative">
                  <input
                    type="radio"
                    name="source"
                    className="peer absolute inset-0 cursor-pointer opacity-0"
                    checked={source === s}
                    onChange={() => setSource(s)}
                  />
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-pill border py-[7px] pr-[13px] pl-[9px] text-13 font-medium transition-colors duration-[120ms] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                      source === s
                        ? 'border-accent bg-accent-dim text-ink'
                        : 'border-line-strong text-ink-muted hover:border-ink-faint hover:text-ink'
                    }`}
                  >
                    <i className={`h-2 w-2 rounded-full ${sourceDotClass[s]}`} aria-hidden="true" />
                    {sourceLabels[s]}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Оценка клиента */}
          <div className="flex flex-col gap-1">
            <span className="text-13 font-medium text-ink-muted" id="rate-label">
              {copy.genRatingLabel}
            </span>
            <div className="mt-2 inline-flex gap-1" role="radiogroup" aria-labelledby="rate-label">
              {[1, 2, 3, 4, 5].map((n) => (
                <label key={n} className="relative">
                  <input
                    type="radio"
                    name="rating"
                    className="peer absolute inset-0 cursor-pointer opacity-0"
                    checked={rating === n}
                    aria-label={ratingAria(n)}
                    onChange={() => setRating(n)}
                    onClick={() => {
                      // Повторный клик по выбранной оценке снимает её (rating необязателен)
                      if (rating === n) setRating(null);
                    }}
                  />
                  <span
                    className={`grid h-[34px] w-[34px] place-items-center rounded-md border text-14 transition-colors duration-[120ms] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                      rating === n
                        ? 'border-accent bg-accent-dim text-accent'
                        : 'border-line-strong text-ink-muted hover:border-ink-faint hover:text-ink'
                    }`}
                  >
                    {n}
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-13 text-ink-faint">{copy.genRatingHint}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" variant="primary" disabled={pending || remaining === 0}>
            {copy.genSubmit}
          </Button>
          {remaining !== null ? (
            remaining > 0 ? (
              <span className="text-13 text-ink-faint">{genLimitNote(remaining)}</span>
            ) : (
              <span className="text-13 text-ink-faint">
                {copy.genLimitNoteZero}{' '}
                <Link href="/app/upgrade" className="text-accent hover:underline">
                  {copy.limitCtaLink}
                </Link>
              </span>
            )
          ) : null}
        </div>
      </form>
    </section>
  );
}
