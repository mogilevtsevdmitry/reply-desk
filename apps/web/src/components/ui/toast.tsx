'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface ToastState {
  message: string;
  kind: 'success' | 'error';
  visible: boolean;
}

interface ToastApi {
  showToast: (message: string, kind?: 'success' | 'error') => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const AUTOHIDE_MS = 2200;

/** Тост внизу по центру: подъём 8px + fade 240 мс, autohide 2.2 с (MOTION.md). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>({ message: '', kind: 'success', visible: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, kind, visible: true });
    timer.current = setTimeout(() => {
      setToast((t) => ({ ...t, visible: false }));
    }, AUTOHIDE_MS);
  }, []);

  const api = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role={toast.kind === 'error' ? 'alert' : 'status'}
        className={`rd-toast fixed bottom-6 left-1/2 z-50 inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface-2 py-3 pr-4 pl-4 text-14 shadow-3 ${
          toast.kind === 'error' ? 'border-l-[3px] border-l-danger' : 'border-l-[3px] border-l-ok'
        } ${toast.visible ? 'is-show' : ''}`}
      >
        <span className={toast.kind === 'error' ? 'text-danger' : 'text-ok'} aria-hidden="true">
          {toast.kind === 'error' ? '✕' : '✓'}
        </span>
        {toast.message}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
