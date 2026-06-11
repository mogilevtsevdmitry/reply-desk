import type { Metadata } from 'next';
import { UpgradePage } from '@/components/upgrade/upgrade-page';

export const metadata: Metadata = { title: 'ReplyDesk — тарифы' };

export default function Upgrade() {
  return <UpgradePage />;
}
