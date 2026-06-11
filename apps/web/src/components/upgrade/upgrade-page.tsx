'use client';

import Link from 'next/link';
import { copy, limitCtaToast, limitText, limitTitle } from '@/lib/copy';
import { useAuth } from '@/lib/auth/auth-context';
import { periodAccusative, periodResetDate, planLabel } from '@/lib/format';
import { useCompanyMe } from '@/lib/hooks';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';

/**
 * Экран 402 — лимит исчерпан (заглушка апгрейда, ADR-012):
 * только известные факты (лимиты тарифов), без цен; CTA — заглушка с тостом.
 */
export function UpgradePage() {
  const { data: company } = useCompanyMe();
  const { email } = useAuth();
  const { showToast } = useToast();

  if (!company) return <div aria-busy="true" />;

  const { usage } = company;

  return (
    <section className="max-w-[640px]">
      <h1 className="m-0 mb-4 font-display text-28 leading-tight font-normal min-[881px]:text-36">
        {limitTitle(periodAccusative(usage.period))}
      </h1>
      <p className="m-0 mb-8 text-14 text-ink-muted">
        {limitText(usage.limit, planLabel(company.plan), periodResetDate(usage.period))}
      </p>

      <p className="m-0 mb-4 text-14">{copy.limitPlansIntro}</p>
      <div className="mb-8 grid grid-cols-1 gap-4 min-[720px]:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-6 shadow-2">
          <h2 className="m-0 mb-2 font-display text-22 font-normal">{copy.planStartName}</h2>
          <p className="m-0 text-14 text-ink-muted">{copy.planStartDesc}</p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-6 shadow-2">
          <h2 className="m-0 mb-2 font-display text-22 font-normal">{copy.planBusinessName}</h2>
          <p className="m-0 text-14 text-ink-muted">{copy.planBusinessDesc}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          onClick={() => showToast(limitCtaToast(email ?? 'вашу почту'))}
        >
          {copy.limitCta}
        </Button>
        <Link
          href="/app/history"
          className="inline-flex rounded-md border border-line-strong px-5 py-[13px] text-14 leading-none font-medium text-ink transition-colors duration-[120ms] hover:bg-surface-2"
        >
          {copy.limitBack}
        </Link>
      </div>
    </section>
  );
}
