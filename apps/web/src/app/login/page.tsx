import type { Metadata } from 'next';
import { AuthScreen } from '@/components/auth/auth-screen';
import { GuestOnly } from '@/components/guards';

export const metadata: Metadata = { title: 'ReplyDesk — вход' };

export default function LoginPage() {
  return (
    <GuestOnly>
      <AuthScreen mode="login" />
    </GuestOnly>
  );
}
