'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useToast } from '@/components/ui/toast';
import { onSessionExpired, refreshAccessToken } from '../api/client';
import { logout as apiLogout } from '../api/endpoints';
import { copy } from '../copy';
import { decodeAccessPayload, getAccessToken, setAccessToken, subscribeToken } from '../api/token';

export type AuthStatus = 'loading' | 'guest' | 'authed';

interface AuthState {
  status: AuthStatus;
  /** null до онбординга (ADR-005). */
  companyId: string | null;
  /** Почта пользователя, известная в рамках этой вкладки (для limit-cta-toast). */
  email: string | null;
  /** Сохранить access-токен после login / POST /company. */
  setSession: (accessToken: string, email?: string) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const bootstrapped = useRef(false);

  const syncFromToken = useCallback(() => {
    const payload = decodeAccessPayload(getAccessToken());
    if (payload) {
      setStatus('authed');
      setCompanyId(payload.companyId);
    } else {
      setStatus('guest');
      setCompanyId(null);
    }
  }, []);

  // Восстановление сессии при старте: POST /auth/refresh по httpOnly-куке.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void refreshAccessToken().then(() => syncFromToken());
  }, [syncFromToken]);

  // Любая смена токена (refresh-interceptor, онбординг) — пересчёт состояния.
  useEffect(() => subscribeToken(syncFromToken), [syncFromToken]);

  // refresh не удался по 401 → guest + redirect на /login.
  useEffect(
    () =>
      onSessionExpired(() => {
        queryClient.clear();
        showToast(copy.errorSessionExpired, 'error');
        router.replace('/login');
      }),
    [queryClient, router, showToast],
  );

  const setSession = useCallback((accessToken: string, knownEmail?: string) => {
    if (knownEmail) {
      setEmail(knownEmail);
      // Persist email so it survives session restoration via rd_refresh cookie
      try { localStorage.setItem('rd_email', knownEmail); } catch { /* ignore */ }
    }
    setAccessToken(accessToken);
  }, []);

  // Restore email from localStorage on bootstrap (session via refresh cookie)
  useEffect(() => {
    try {
      const stored = localStorage.getItem('rd_email');
      if (stored) setEmail(stored);
    } catch { /* ignore */ }
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // ревокация не удалась (сеть) — локальный выход всё равно выполняем
    }
    setAccessToken(null);
    setEmail(null);
    try { localStorage.removeItem('rd_email'); } catch { /* ignore */ }
    queryClient.clear();
    router.replace('/login');
  }, [queryClient, router]);

  const value = useMemo<AuthState>(
    () => ({ status, companyId, email, setSession, logout }),
    [status, companyId, email, setSession, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
