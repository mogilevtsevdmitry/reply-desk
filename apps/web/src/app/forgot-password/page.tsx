import type { Metadata } from 'next';
import { ForgotPasswordScreen } from '@/components/auth/forgot-password-screen';

export const metadata: Metadata = { title: 'ReplyDesk — восстановление пароля' };

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
