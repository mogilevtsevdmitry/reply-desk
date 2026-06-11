'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getCompanyMe } from './api/endpoints';
import { useAuth } from './auth/auth-context';

export const COMPANY_ME_KEY = ['company', 'me'] as const;

/** Компания + usage текущего периода (счётчик лимита). */
export function useCompanyMe() {
  const { status, companyId } = useAuth();
  return useQuery({
    queryKey: COMPANY_ME_KEY,
    queryFn: getCompanyMe,
    enabled: status === 'authed' && companyId !== null,
  });
}

/** prefers-reduced-motion: reduce → статичная версия анимаций (MOTION.md). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
