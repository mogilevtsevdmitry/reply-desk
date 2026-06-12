'use client';

import {
  CategorySchema,
  ReviewSourceSchema,
  type ReviewWithGeneration,
} from '@replydesk/contracts';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { countReviewsLast30Days, listReviews, type ReviewFilters } from '@/lib/api/endpoints';
import { copy, filterSeverityOption, historyFoot, historySub } from '@/lib/copy';
import { formatDay } from '@/lib/format';
import { categoryLabels, sourceDotClass, sourceLabels } from '@/lib/labels';
import { Button } from '../ui/button';
import { Select } from '../ui/field';
import { SevComb } from '../ui/sev-comb';

const PAGE_SIZE = 20;

const EMPTY_FILTERS: ReviewFilters = {};

function hasActiveFilters(f: ReviewFilters): boolean {
  return Boolean(f.source || f.category || f.severity || f.from || f.to);
}

export function HistoryPage() {
  const [filters, setFilters] = useState<ReviewFilters>(EMPTY_FILTERS);

  const { data: last30 } = useQuery({
    queryKey: ['reviews', 'count-30d'],
    queryFn: countReviewsLast30Days,
  });

  const query = useInfiniteQuery({
    queryKey: ['reviews', 'list', filters],
    queryFn: ({ pageParam }) => listReviews(filters, pageParam, PAGE_SIZE),
    initialPageParam: 1,
    getNextPageParam: (lastPage, pages) => {
      const shown = pages.reduce((acc, p) => acc + p.items.length, 0);
      return shown < lastPage.total ? pages.length + 1 : undefined;
    },
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.total ?? 0;

  const set = (patch: Partial<ReviewFilters>): void =>
    setFilters((prev) => ({ ...prev, ...patch }));

  return (
    <section>
      <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal min-[881px]:text-36">
        {copy.historyTitle}
      </h1>
      <p className="m-0 mb-6 text-14 text-ink-muted">
        {last30 !== undefined ? historySub(last30) : ' '}
      </p>

      {/* Фильтры */}
      <form className="mb-6 flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
        <FilterControl label={copy.filterSourceLabel} htmlFor="f-src">
          <Select
            id="f-src"
            className="min-w-[150px] !w-auto !bg-surface !py-[9px] !text-14"
            value={filters.source ?? ''}
            onChange={(e) => set({ source: e.target.value || undefined })}
          >
            <option value="">{copy.filterSourceAll}</option>
            {ReviewSourceSchema.options.map((s) => (
              <option key={s} value={s}>
                {sourceLabels[s]}
              </option>
            ))}
          </Select>
        </FilterControl>
        <FilterControl label={copy.filterCategoryLabel} htmlFor="f-cat">
          <Select
            id="f-cat"
            className="min-w-[150px] !w-auto !bg-surface !py-[9px] !text-14"
            value={filters.category ?? ''}
            onChange={(e) => set({ category: e.target.value || undefined })}
          >
            <option value="">{copy.filterCategoryAll}</option>
            {CategorySchema.options.map((c) => (
              <option key={c} value={c}>
                {categoryLabels[c]}
              </option>
            ))}
          </Select>
        </FilterControl>
        <FilterControl label={copy.filterSeverityLabel} htmlFor="f-sev">
          <Select
            id="f-sev"
            className="min-w-[150px] !w-auto !bg-surface !py-[9px] !text-14"
            value={filters.severity ? String(filters.severity) : ''}
            onChange={(e) => set({ severity: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">{copy.filterSeverityAll}</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {filterSeverityOption(n)}
              </option>
            ))}
          </Select>
        </FilterControl>
        <FilterControl label={copy.filterDateFrom} htmlFor="f-from">
          <input
            id="f-from"
            type="date"
            value={filters.from ?? ''}
            onChange={(e) => set({ from: e.target.value || undefined })}
            className="rd-input rd-date min-w-[150px] rounded-md border border-line-strong bg-surface px-3 py-[9px] font-text text-14 text-ink transition-colors duration-[120ms] hover:border-ink-faint"
          />
        </FilterControl>
        <FilterControl label={copy.filterDateTo} htmlFor="f-to">
          <input
            id="f-to"
            type="date"
            value={filters.to ?? ''}
            onChange={(e) => set({ to: e.target.value || undefined })}
            className="rd-input rd-date min-w-[150px] rounded-md border border-line-strong bg-surface px-3 py-[9px] font-text text-14 text-ink transition-colors duration-[120ms] hover:border-ink-faint"
          />
        </FilterControl>
        <Button variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
          {copy.filterReset}
        </Button>
      </form>

      {/* Список / пустые состояния */}
      {query.isSuccess && items.length === 0 ? (
        hasActiveFilters(filters) ? (
          <EmptyState
            title={copy.historyNoresTitle}
            text={copy.historyNoresText}
            action={
              <Button variant="secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
                {copy.historyNoresCta}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={copy.historyEmptyTitle}
            text={copy.historyEmptyText}
            action={
              <Link
                href="/app"
                className="inline-flex rounded-md border border-line-strong px-5 py-[13px] text-14 leading-none font-medium text-ink transition-colors duration-[120ms] hover:bg-surface-2"
              >
                {copy.historyEmptyCta}
              </Link>
            }
          />
        )
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <HistoryRow key={item.id} item={item} />
            ))}
          </div>
          {items.length > 0 ? (
            <div className="mt-6 flex items-center justify-between text-13 text-ink-faint">
              <span>{historyFoot(items.length, total)}</span>
              {query.hasNextPage ? (
                <Button
                  variant="ghost"
                  disabled={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {copy.historyMore}
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function FilterControl({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 basis-[45%] flex-col gap-1 min-[881px]:flex-none min-[881px]:basis-auto">
      <label
        htmlFor={htmlFor}
        className="text-12 font-medium tracking-caps text-ink-faint uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function HistoryRow({ item }: { item: ReviewWithGeneration }) {
  // FAILED-строк в истории нет по построению (ADR-042: упавшая генерация удаляется);
  // возможные статусы — PENDING/ANALYZING/GENERATING/DONE.
  return (
    <Link
      href={`/app/reviews/${item.id}`}
      className="grid grid-cols-1 items-center gap-2 rounded-lg border border-line bg-surface px-5 py-4 transition-colors duration-[120ms] hover:border-line-strong hover:bg-surface-2 min-[881px]:grid-cols-[auto_1fr_auto] min-[881px]:gap-4"
    >
      <SevComb level={item.severity ?? 0} />
      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2 text-13 text-ink-muted">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <i className={`h-2 w-2 rounded-full ${sourceDotClass[item.source]}`} aria-hidden="true" />
            {sourceLabels[item.source]}
          </span>
          {item.category ? (
            <span className="before:mr-2 before:text-ink-faint before:content-['·']">
              {categoryLabels[item.category]}
            </span>
          ) : null}
        </div>
        <p className="m-0 line-clamp-2 text-14 text-ink min-[881px]:line-clamp-none min-[881px]:truncate">
          {item.rawText}
        </p>
      </div>
      <span className="text-13 whitespace-nowrap text-ink-faint">{formatDay(item.createdAt)}</span>
    </Link>
  );
}

function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface px-6 py-12 text-center shadow-2">
      <h2 className="m-0 mb-2 font-display text-22 leading-tight font-normal">{title}</h2>
      <p className="m-0 mb-5 text-14 text-ink-muted">{text}</p>
      {action}
    </div>
  );
}
