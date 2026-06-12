import type { Metadata } from 'next';
import { ResetPasswordScreen } from '@/components/auth/reset-password-screen';

export const metadata: Metadata = { title: 'ReplyDesk — новый пароль' };

/** Токен берём из query на сервере: без useSearchParams и Suspense-обёртки. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  return <ResetPasswordScreen token={token} />;
}
