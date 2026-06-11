import type { Metadata } from 'next';
import { GeneratePage } from '@/components/generation/generate-page';

export const metadata: Metadata = { title: 'ReplyDesk — генерация' };

export default function AppHome() {
  return <GeneratePage />;
}
