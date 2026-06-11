'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { useAuth } from '@/lib/auth/auth-context';

/**
 * Гарды маршрутов (02-DEVELOPER §5):
 * - без сессии → /login;
 * - с сессией без компании → /onboarding;
 * - онбординг при готовой компании → /app;
 * - страницы auth при живой сессии → /app | /onboarding.
 */

function Splash() {
  // Нейтральный экран на время восстановления сессии (POST /auth/refresh)
  return <div className="min-h-screen bg-bg" aria-busy="true" />;
}

export function RequireCompany({ children }: { children: ReactNode }) {
  const { status, companyId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'guest') router.replace('/login');
    else if (status === 'authed' && companyId === null) router.replace('/onboarding');
  }, [status, companyId, router]);

  if (status !== 'authed' || companyId === null) return <Splash />;
  return <>{children}</>;
}

export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { status, companyId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'guest') router.replace('/login');
    else if (status === 'authed' && companyId !== null) router.replace('/app');
  }, [status, companyId, router]);

  if (status !== 'authed' || companyId !== null) return <Splash />;
  return <>{children}</>;
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const { status, companyId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authed') {
      router.replace(companyId === null ? '/onboarding' : '/app');
    }
  }, [status, companyId, router]);

  if (status !== 'guest') return <Splash />;
  return <>{children}</>;
}
