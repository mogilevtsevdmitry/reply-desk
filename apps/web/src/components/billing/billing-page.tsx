'use client';

import type {
  BillingOverview,
  CheckoutDto,
  PackageSize,
  PeriodMonths,
  SubscriptionPlan,
} from '@replydesk/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { isApiError } from '@/lib/api/client';
import {
  billingCheckout,
  cancelSubscription,
  setAutoRenew,
  unbindCard,
} from '@/lib/api/endpoints';
import {
  PACKAGE_PRICES,
  PACKAGE_SIZES,
  PERIOD_OPTIONS,
  PLAN_LIMITS,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRICES,
  perMonthPrice,
  periodDiscountPct,
} from '@/lib/billing/prices';
import {
  billingDiscount,
  billingPackName,
  billingPerMonth,
  billingPeriodOption,
  billingPlanLimit,
  billingValidUntil,
  copy,
  toastCancelledRefund,
  txnStatusLabels,
  usageBarAria,
  usageNum,
  usagePackageNote,
} from '@/lib/copy';
import {
  formatDayYear,
  formatDateTime,
  formatKopecks,
  periodPrepositional,
  planLabel,
} from '@/lib/format';
import { BILLING_KEY, COMPANY_ME_KEY, useBillingOverview } from '@/lib/hooks';
import { Button } from '../ui/button';
import { useToast } from '../ui/toast';

const PLAN_DESC: Record<SubscriptionPlan, string> = {
  START: copy.planStartDesc,
  BUSINESS: copy.planBusinessDesc,
};

/** Поллинг после возврата с оплаты (?status=ok): активация приходит вебхуком асинхронно. */
type ProcessingState = 'idle' | 'processing' | 'done' | 'timeout';
const POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 2500;

/**
 * Страница «Тариф и оплата» (/app/billing): текущая подписка, оформление
 * START/BUSINESS на 1/3/6/12 мес, разовые пакеты, история платежей, отмена.
 * Цены — статичная таблица lib/billing/prices.ts (ADR-039), суммы API — копейки.
 */
export function BillingPage() {
  const { data, isPending, isError, refetch } = useBillingOverview();
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [processing, setProcessing] = useState<ProcessingState>('idle');

  // Возврат со страницы ЮKassa: убрать ?status=ok из URL и начать поллинг.
  const paymentReturned = searchParams.get('status') === 'ok';
  useEffect(() => {
    if (!paymentReturned) return;
    setProcessing('processing');
    router.replace('/app/billing');
  }, [paymentReturned, router]);

  useEffect(() => {
    if (processing !== 'processing') return;
    let cancelled = false;
    void (async () => {
      for (let i = 0; i < POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (cancelled) return;
        const res = await refetch();
        const last = res.data?.transactions[0];
        if (last && last.status !== 'PENDING') {
          // Тариф/лимит в сайдбаре питаются company/me — обновить и его
          void queryClient.invalidateQueries({ queryKey: COMPANY_ME_KEY });
          if (!cancelled) setProcessing('done');
          return;
        }
      }
      if (!cancelled) setProcessing('timeout');
    })();
    return () => {
      cancelled = true;
    };
  }, [processing, refetch, queryClient]);

  if (isPending) return <BillingSkeleton />;

  if (isError || !data) {
    return (
      <section className="max-w-[760px]">
        <h1 className="m-0 mb-4 font-display text-28 leading-tight font-normal min-[881px]:text-36">
          {copy.billingTitle}
        </h1>
        <p className="m-0 mb-4 text-14 text-ink-muted">{copy.billingLoadError}</p>
        <Button onClick={() => void refetch()}>{copy.billingRefresh}</Button>
      </section>
    );
  }

  return (
    <section className="max-w-[760px]">
      <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal min-[881px]:text-36">
        {copy.billingTitle}
      </h1>
      <p className="m-0 mb-8 text-14 text-ink-muted">{copy.billingSub}</p>

      {processing !== 'idle' ? (
        <ProcessingBanner
          state={processing}
          onRefresh={() => {
            setProcessing('processing');
          }}
        />
      ) : null}

      {!data.billingEnabled ? (
        <p
          role="status"
          className="m-0 mb-6 rounded-md border border-line-strong bg-surface-2 px-4 py-3 text-14 text-ink-muted"
        >
          {copy.billingDisabledNote}
        </p>
      ) : null}

      <CurrentPlanSection overview={data} />
      <SubscriptionsSection overview={data} />
      <PackagesSection overview={data} />
      <HistorySection overview={data} />
      {data.subscription && data.subscription.status === 'ACTIVE' ? <CancelSection /> : null}
    </section>
  );
}

// ---------- Скелетон загрузки ----------

function BillingSkeleton() {
  return (
    <section aria-busy="true" className="max-w-[760px]">
      <div className="mb-2 h-9 w-72 animate-pulse rounded-md bg-surface-2" />
      <div className="mb-8 h-5 w-96 max-w-full animate-pulse rounded-md bg-surface-2" />
      {[160, 280, 200, 180].map((h) => (
        <div key={h} className="mb-6 animate-pulse rounded-lg bg-surface-2" style={{ height: h }} />
      ))}
    </section>
  );
}

// ---------- Баннер «платёж обрабатывается» ----------

function ProcessingBanner({
  state,
  onRefresh,
}: {
  state: ProcessingState;
  onRefresh: () => void;
}) {
  if (state === 'done') {
    return (
      <p
        role="status"
        className="m-0 mb-6 rounded-md border border-line-strong border-l-[3px] border-l-ok bg-surface-2 px-4 py-3 text-14"
      >
        {copy.billingProcessingDone}
      </p>
    );
  }
  if (state === 'timeout') {
    return (
      <div
        role="status"
        className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line-strong bg-surface-2 px-4 py-3 text-14"
      >
        <span>{copy.billingProcessingTimeout}</span>
        <Button variant="ghost" className="!py-2" onClick={onRefresh}>
          {copy.billingRefresh}
        </Button>
      </div>
    );
  }
  return (
    <p
      role="status"
      aria-busy="true"
      className="m-0 mb-6 rounded-md border border-line-strong bg-surface-2 px-4 py-3 text-14 text-ink-muted"
    >
      {copy.billingProcessing}
    </p>
  );
}

// ---------- (а) Текущий тариф ----------

function CurrentPlanSection({ overview }: { overview: BillingOverview }) {
  const { subscription: sub, usage, packageCredits } = overview;
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: BILLING_KEY });
    void queryClient.invalidateQueries({ queryKey: COMPANY_ME_KEY });
  };

  const onMutationError = (err: unknown): void => {
    if (isApiError(err) && err.code === 'NETWORK') showToast(copy.errorNetwork, 'error');
    else if (isApiError(err) && err.status < 500) showToast(err.message, 'error');
    else showToast(copy.errorServer, 'error');
  };

  const autoRenewMutation = useMutation({
    mutationFn: setAutoRenew,
    onSuccess: (_data, enabled) => {
      invalidate();
      showToast(enabled ? copy.toastAutoRenewOn : copy.toastAutoRenewOff);
    },
    onError: onMutationError,
  });

  const unbindMutation = useMutation({
    mutationFn: unbindCard,
    onSuccess: () => {
      invalidate();
      showToast(copy.toastCardUnbound);
    },
    onError: onMutationError,
  });

  const pct = usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0;

  return (
    <div className="mb-6 rounded-lg border border-line bg-surface p-6 shadow-2">
      <h2 className="m-0 mb-4 font-display text-22 font-normal">{copy.billingCurrentTitle}</h2>

      {sub ? (
        <p className="m-0 mb-4 text-14">
          <b className="font-semibold">{planLabel(sub.plan)}</b>
          {' · '}
          {billingPeriodOption(sub.periodMonths)}
          {' · '}
          {sub.status === 'ACTIVE'
            ? billingValidUntil(formatDayYear(sub.expiresAt))
            : sub.status === 'CANCELLED'
              ? copy.billingStatusCancelled
              : copy.billingStatusExpired}
        </p>
      ) : (
        <p className="m-0 mb-4 text-14 text-ink-muted">{copy.billingNoSubscription}</p>
      )}

      {/* Остаток лимита месяца + пакетные генерации */}
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3">
        <span className="font-display text-28 leading-none">
          {usageNum(usage.used, usage.limit)}
        </span>
        <span className="text-13 text-ink-muted">
          {copy.billingUsageLeftLabel.toLowerCase()} ({periodPrepositional(usage.period)})
        </span>
        {packageCredits > 0 ? (
          <span className="text-13 text-accent">{usagePackageNote(packageCredits)}</span>
        ) : null}
      </div>
      <div
        className="mb-4 h-1.5 max-w-[320px] overflow-hidden rounded-[3px] bg-line"
        role="img"
        aria-label={usageBarAria(usage.used, usage.limit)}
      >
        <i className="block h-full rounded-[3px] bg-accent" style={{ width: `${pct}%` }} />
      </div>

      {sub && sub.status === 'ACTIVE' ? (
        <div className="flex flex-col gap-3 border-t border-line pt-4">
          {/* Автопродление — тумблер */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="block text-14 font-medium">{copy.billingAutoRenewLabel}</span>
              <span className="block text-13 text-ink-faint">
                {sub.autoRenew ? copy.billingAutoRenewOnNote : copy.billingAutoRenewOffNote}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={sub.autoRenew}
              aria-label={copy.billingAutoRenewLabel}
              disabled={autoRenewMutation.isPending || (!sub.card && !sub.autoRenew)}
              onClick={() => autoRenewMutation.mutate(!sub.autoRenew)}
              className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full border transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-60 ${
                sub.autoRenew ? 'border-accent bg-accent' : 'border-line-strong bg-surface-2'
              }`}
            >
              <i
                className={`absolute top-1/2 block h-4 w-4 -translate-y-1/2 rounded-full transition-[left] duration-[120ms] ${
                  sub.autoRenew ? 'left-[22px] bg-ink-on-accent' : 'left-1 bg-ink-faint'
                }`}
              />
            </button>
          </div>

          {/* Карта */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="block text-14 font-medium">{copy.billingCardLabel}</span>
              <span className="block text-13 text-ink-faint">
                {sub.card
                  ? `${sub.card.brand ? `${sub.card.brand} ` : ''}•••• ${sub.card.last4}`
                  : copy.billingCardNone}
              </span>
            </div>
            {sub.card ? (
              <Button
                variant="ghost"
                className="!py-2"
                disabled={unbindMutation.isPending}
                onClick={() => unbindMutation.mutate()}
              >
                {copy.billingCardUnbind}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------- Общий хук покупки (checkout → redirect на ЮKassa) ----------

function useCheckout() {
  const { showToast } = useToast();
  return useMutation({
    mutationFn: billingCheckout,
    onSuccess: ({ confirmationUrl }) => {
      window.location.href = confirmationUrl;
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'NETWORK') showToast(copy.errorNetwork, 'error');
      else if (isApiError(err) && (err.status === 503 || err.code === 'BILLING_DISABLED'))
        showToast(copy.billingDisabledNote, 'error');
      else if (isApiError(err) && err.status < 500) showToast(err.message, 'error');
      else showToast(copy.errorServer, 'error');
    },
  });
}

// ---------- (б) Подписки ----------

function SubscriptionsSection({ overview }: { overview: BillingOverview }) {
  const [period, setPeriod] = useState<PeriodMonths>(1);
  const checkout = useCheckout();
  const sub = overview.subscription;

  const buy = (plan: SubscriptionPlan): void => {
    const dto: CheckoutDto = { kind: 'subscription', plan, periodMonths: period };
    checkout.mutate(dto);
  };

  return (
    <div className="mb-6 rounded-lg border border-line bg-surface p-6 shadow-2">
      <h2 className="m-0 mb-4 font-display text-22 font-normal">{copy.billingPlansTitle}</h2>

      {/* Переключатель периода 1/3/6/12 мес */}
      <div className="mb-4 flex flex-col gap-1">
        <span id="billing-period-label" className="text-13 font-medium text-ink-muted">
          {copy.billingPeriodLabel}
        </span>
        <div
          role="radiogroup"
          aria-labelledby="billing-period-label"
          className="inline-flex w-fit max-w-full flex-wrap gap-1 rounded-md border border-line-strong p-1"
        >
          {PERIOD_OPTIONS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={period === m}
              onClick={() => setPeriod(m)}
              className={`cursor-pointer rounded-[4px] border-0 px-3 py-1.5 text-13 font-medium transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                period === m
                  ? 'bg-accent text-ink-on-accent'
                  : 'bg-transparent text-ink-muted hover:bg-surface-2 hover:text-ink'
              }`}
            >
              {billingPeriodOption(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 min-[720px]:grid-cols-2">
        {SUBSCRIPTION_PLANS.map((plan) => {
          const price = SUBSCRIPTION_PRICES[plan][period];
          const discount = periodDiscountPct(plan, period);
          const isCurrent = sub?.status === 'ACTIVE' && sub.plan === plan;
          return (
            <div key={plan} className="rounded-lg border border-line-strong p-5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <h3 className="m-0 font-display text-22 font-normal">{planLabel(plan)}</h3>
                {isCurrent ? (
                  <span className="rounded-full border border-accent px-2.5 py-1 text-12 leading-none text-accent">
                    {copy.billingPlanCurrentBadge}
                  </span>
                ) : null}
              </div>
              <p className="m-0 mb-1 text-14 font-medium">{billingPlanLimit(PLAN_LIMITS[plan])}</p>
              <p className="m-0 mb-4 text-13 text-ink-muted">{PLAN_DESC[plan]}</p>
              <p className="m-0 mb-4">
                <span className="font-display text-28 leading-none">{formatKopecks(price)}</span>
                <span className="ml-2 text-13 text-ink-muted">
                  {billingPerMonth(formatKopecks(perMonthPrice(plan, period)))}
                  {discount > 0 ? (
                    <span className="ml-1.5 text-accent">{billingDiscount(discount)}</span>
                  ) : null}
                </span>
              </p>
              <Button
                variant="primary"
                className="w-full"
                disabled={!overview.billingEnabled || checkout.isPending}
                onClick={() => buy(plan)}
              >
                {sub?.status === 'ACTIVE' && sub.plan !== plan
                  ? copy.billingChangePlan
                  : copy.billingSubscribe}
              </Button>
            </div>
          );
        })}
      </div>

      <LegalNote recurring />
    </div>
  );
}

// ---------- (в) Пакеты по запросу ----------

function PackagesSection({ overview }: { overview: BillingOverview }) {
  const checkout = useCheckout();

  const buy = (size: PackageSize): void => {
    checkout.mutate({ kind: 'package', size });
  };

  return (
    <div className="mb-6 rounded-lg border border-line bg-surface p-6 shadow-2">
      <h2 className="m-0 mb-1 font-display text-22 font-normal">{copy.billingPacksTitle}</h2>
      <p className="m-0 mb-4 text-13 text-ink-muted">{copy.billingPacksNote}</p>

      <div className="mb-4 grid grid-cols-1 gap-4 min-[720px]:grid-cols-3">
        {PACKAGE_SIZES.map((size) => (
          <div key={size} className="rounded-lg border border-line-strong p-5">
            <p className="m-0 mb-1 text-14 font-medium">{billingPackName(size)}</p>
            <p className="m-0 mb-4 font-display text-28 leading-none">
              {formatKopecks(PACKAGE_PRICES[size])}
            </p>
            <Button
              className="w-full"
              disabled={!overview.billingEnabled || checkout.isPending}
              onClick={() => buy(size)}
            >
              {copy.billingPackBuy}
            </Button>
          </div>
        ))}
      </div>

      <LegalNote recurring={false} />
    </div>
  );
}

/** Подпись у кнопок оплаты: оферта всегда, рекуррентные условия — только для подписок. */
function LegalNote({ recurring }: { recurring: boolean }) {
  const link = (href: string, label: string): ReactNode => (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline"
    >
      {label}
    </Link>
  );
  return (
    <p className="m-0 text-13 text-ink-faint">
      {copy.billingLegalPrefix}{' '}
      {recurring ? (
        <>
          {link('/legal/recurring-payments', copy.billingLegalRecurring)} {copy.billingLegalAnd}{' '}
          {link('/legal/terms-of-service', copy.billingLegalOffer)}
        </>
      ) : (
        link('/legal/terms-of-service', copy.billingLegalOffer)
      )}
    </p>
  );
}

// ---------- (г) История платежей ----------

function HistorySection({ overview }: { overview: BillingOverview }) {
  return (
    <div className="mb-6 rounded-lg border border-line bg-surface p-6 shadow-2">
      <h2 className="m-0 mb-4 font-display text-22 font-normal">{copy.billingHistoryTitle}</h2>
      {overview.transactions.length === 0 ? (
        <p className="m-0 text-14 text-ink-muted">{copy.billingHistoryEmpty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-14">
            <thead>
              <tr className="border-b border-line text-left text-13 text-ink-muted">
                <th className="py-2 pr-4 font-medium">{copy.billingHistoryColDate}</th>
                <th className="py-2 pr-4 font-medium">{copy.billingHistoryColDesc}</th>
                <th className="py-2 pr-4 text-right font-medium">{copy.billingHistoryColAmount}</th>
                <th className="py-2 font-medium">{copy.billingHistoryColStatus}</th>
              </tr>
            </thead>
            <tbody>
              {overview.transactions.map((txn) => (
                <tr key={txn.id} className="border-b border-line last:border-b-0">
                  <td className="py-2.5 pr-4 whitespace-nowrap text-ink-muted">
                    {formatDateTime(txn.paidAt ?? txn.createdAt)}
                  </td>
                  <td className="py-2.5 pr-4">{txn.description}</td>
                  <td className="py-2.5 pr-4 text-right whitespace-nowrap">
                    {txn.type === 'REFUND' ? '−' : ''}
                    {formatKopecks(txn.amount)}
                  </td>
                  <td
                    className={`py-2.5 whitespace-nowrap ${
                      txn.status === 'FAILED'
                        ? 'text-danger'
                        : txn.status === 'SUCCEEDED'
                          ? 'text-ok'
                          : 'text-ink-muted'
                    }`}
                  >
                    {txnStatusLabels[txn.status] ?? txn.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------- (д) Отмена подписки ----------

function CancelSection() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const cancelMutation = useMutation({
    mutationFn: cancelSubscription,
    onSuccess: ({ refundAmount }) => {
      setDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: BILLING_KEY });
      void queryClient.invalidateQueries({ queryKey: COMPANY_ME_KEY });
      showToast(
        refundAmount > 0
          ? toastCancelledRefund(formatKopecks(refundAmount))
          : copy.toastCancelledNoRefund,
      );
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'NETWORK') showToast(copy.errorNetwork, 'error');
      else if (isApiError(err) && err.status < 500) showToast(err.message, 'error');
      else showToast(copy.errorServer, 'error');
    },
  });

  return (
    <div className="mb-6 rounded-lg border border-line bg-surface p-6 shadow-2">
      <h2 className="m-0 mb-2 font-display text-22 font-normal">{copy.billingCancelTitle}</h2>
      <p className="m-0 mb-4 text-14 text-ink-muted">{copy.billingCancelText}</p>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className="inline-flex cursor-pointer items-center justify-center rounded-md border border-danger px-5 py-[13px] text-14 leading-none font-medium text-danger transition-colors duration-[120ms] hover:bg-danger-dim"
      >
        {copy.billingCancelButton}
      </button>

      {dialogOpen ? (
        <CancelDialog
          pending={cancelMutation.isPending}
          onConfirm={() => cancelMutation.mutate()}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

function CancelDialog({
  pending,
  onConfirm,
  onClose,
}: {
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-sub-title"
        className="w-full max-w-[440px] rounded-lg border border-line bg-surface p-6 shadow-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="cancel-sub-title" className="m-0 mb-2 font-display text-22 leading-tight font-normal">
          {copy.billingCancelDialogTitle}
        </h2>
        <p className="m-0 mb-5 text-14 text-ink-muted">{copy.billingCancelDialogText}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={onClose}>
            {copy.billingCancelKeep}
          </Button>
          <button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className="inline-flex cursor-pointer items-center justify-center rounded-md border border-danger px-5 py-[13px] text-14 leading-none font-medium text-danger transition-colors duration-[120ms] hover:bg-danger-dim disabled:cursor-not-allowed disabled:opacity-60"
          >
            {copy.billingCancelConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
