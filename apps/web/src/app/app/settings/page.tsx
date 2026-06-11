import type { Metadata } from 'next';
import { SettingsPage } from '@/components/settings/settings-form';

export const metadata: Metadata = { title: 'ReplyDesk — настройки' };

export default function Settings() {
  return <SettingsPage />;
}
