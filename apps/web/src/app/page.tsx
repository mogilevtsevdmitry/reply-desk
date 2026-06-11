'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth/auth-context';

/** Корень: маршрутизация по состоянию сессии (гарды, 02-DEVELOPER §5). */
export default function Home() {
  const { status, companyId } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'guest') router.replace('/login');
    else if (status === 'authed') router.replace(companyId === null ? '/onboarding' : '/app');
  }, [status, companyId, router]);

  return <div className="min-h-screen bg-bg" aria-busy="true" />;
}
