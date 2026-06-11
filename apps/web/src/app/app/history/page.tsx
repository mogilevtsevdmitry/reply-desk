import type { Metadata } from 'next';
import { HistoryPage } from '@/components/history/history-page';

export const metadata: Metadata = { title: 'ReplyDesk — история отзывов' };

export default function History() {
  return <HistoryPage />;
}
