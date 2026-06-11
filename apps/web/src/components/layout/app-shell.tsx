'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { copy, usageBarAria, usageLabel, usageNum } from '@/lib/copy';
import { periodPrepositional, planLabel } from '@/lib/format';
import { useAuth } from '@/lib/auth/auth-context';
import { useCompanyMe } from '@/lib/hooks';
import { Button } from '../ui/button';
import { Logo } from '../ui/logo';

const NAV = [
  { href: '/app', label: copy.navGenerate, exact: true },
  { href: '/app/history', label: copy.navHistory, exact: false },
  { href: '/app/settings', label: copy.navSettings, exact: false },
] as const;

/** Повторный клик по активному пункту навигации (роут не меняется) — событие для сброса локального состояния страницы (например, результат → форма на /app). */
export const NAV_REPEAT_EVENT = 'rd:nav-repeat';

/**
 * Каркас приложения (ADR-008): постоянный сайдбар 232px — логотип, навигация,
 * счётчик лимита с прогресс-баром; на ≤880px складывается в верхнюю панель,
 * счётчик сжимается до числа.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { data: company } = useCompanyMe();
  const [logoutOpen, setLogoutOpen] = useState(false);

  const usage = company?.usage;
  const pct = usage && usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0;

  return (
    <div className="grid min-h-screen grid-cols-1 min-[881px]:grid-cols-[232px_1fr]">
      <aside
        className="flex flex-row items-center gap-4 border-b border-line px-4 py-3 min-[881px]:sticky min-[881px]:top-0 min-[881px]:h-screen min-[881px]:flex-col min-[881px]:items-stretch min-[881px]:gap-8 min-[881px]:border-r min-[881px]:border-b-0 min-[881px]:px-4 min-[881px]:py-6"
      >
        <Logo />
        <nav aria-label={copy.navAria} className="flex flex-row gap-[2px] min-[881px]:flex-col">
          {NAV.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => {
                  if (active) {
                    window.dispatchEvent(new CustomEvent(NAV_REPEAT_EVENT, { detail: item.href }));
                  }
                }}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-md px-2.5 py-2 text-13 font-medium transition-colors duration-[120ms] min-[881px]:px-3 min-[881px]:py-2.5 min-[881px]:text-14 ${
                  active ? 'bg-surface-2 text-accent' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto text-right text-13 text-ink-muted min-[881px]:mt-auto min-[881px]:ml-0 min-[881px]:text-left">
          {usage ? (
            <>
              <span className="font-display text-16 text-ink min-[881px]:block min-[881px]:text-22">
                {usageNum(usage.used, usage.limit)}
              </span>
              <span className="hidden min-[881px]:inline">
                {company ? usageLabel(periodPrepositional(usage.period), planLabel(company.plan)) : null}
              </span>
              <div
                className="mt-2 hidden h-1 overflow-hidden rounded-[2px] bg-line min-[881px]:block"
                role="img"
                aria-label={usageBarAria(usage.used, usage.limit)}
              >
                <i className="block h-full rounded-[2px] bg-accent" style={{ width: `${pct}%` }} />
              </div>
              {usage.used >= usage.limit ? (
                <Link
                  href="/app/upgrade"
                  className="mt-2 hidden text-13 text-accent hover:underline min-[881px]:block"
                >
                  {copy.limitCtaLink}
                </Link>
              ) : null}
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setLogoutOpen(true)}
            className="mt-0 ml-3 cursor-pointer rounded-md px-2 py-1 text-13 text-ink-faint transition-colors duration-[120ms] hover:bg-surface-2 hover:text-ink min-[881px]:mt-4 min-[881px]:ml-0 min-[881px]:px-0 min-[881px]:hover:bg-transparent"
          >
            {copy.logoutTrigger}
          </button>
        </div>
      </aside>

      <main className="max-w-[1040px] px-4 pt-6 pb-12 min-[881px]:px-8 min-[881px]:pt-8 min-[881px]:pb-16">
        {children}
      </main>

      {logoutOpen ? <LogoutDialog onClose={() => setLogoutOpen(false)} /> : null}
    </div>
  );
}

function LogoutDialog({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth();

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
        aria-labelledby="logout-title"
        className="w-full max-w-[400px] rounded-lg border border-line bg-surface p-6 shadow-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="logout-title" className="m-0 mb-2 font-display text-22 leading-tight font-normal">
          {copy.logoutTitle}
        </h2>
        <p className="m-0 mb-5 text-14 text-ink-muted">{copy.logoutText}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" autoFocus onClick={onClose}>
            {copy.logoutCancel}
          </Button>
          <button
            type="button"
            onClick={() => void logout()}
            className="inline-flex cursor-pointer items-center justify-center rounded-md border border-danger px-5 py-[13px] text-14 leading-none font-medium text-danger transition-colors duration-[120ms] hover:bg-danger-dim"
          >
            {copy.logoutConfirm}
          </button>
        </div>
      </div>
    </div>
  );
}
