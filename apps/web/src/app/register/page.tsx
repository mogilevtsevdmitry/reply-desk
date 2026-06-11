import type { Metadata } from 'next';
import { AuthScreen } from '@/components/auth/auth-screen';
import { GuestOnly } from '@/components/guards';

export const metadata: Metadata = { title: 'ReplyDesk — регистрация' };

export default function RegisterPage() {
  return (
    <GuestOnly>
      <AuthScreen mode="signup" />
    </GuestOnly>
  );
}
