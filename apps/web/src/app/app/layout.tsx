import type { ReactNode } from 'react';
import { RequireCompany } from '@/components/guards';
import { AppShell } from '@/components/layout/app-shell';

/** Раздел /app: гард «сессия + компания» и каркас с сайдбаром (ADR-008). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireCompany>
      <AppShell>{children}</AppShell>
    </RequireCompany>
  );
}
