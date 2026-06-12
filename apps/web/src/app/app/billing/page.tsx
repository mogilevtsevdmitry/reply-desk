import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BillingPage } from '@/components/billing/billing-page';

export const metadata: Metadata = { title: 'ReplyDesk — тариф и оплата' };

/** useSearchParams (возврат с оплаты ?status=ok) требует Suspense-границу. */
export default function Billing() {
  return (
    <Suspense fallback={<div aria-busy="true" />}>
      <BillingPage />
    </Suspense>
  );
}
