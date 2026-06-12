'use client';

import { ForgotPasswordDtoSchema } from '@replydesk/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { isApiError } from '@/lib/api/client';
import { forgotPassword } from '@/lib/api/endpoints';
import { copy } from '@/lib/copy';
import { Field, Input } from '../ui/field';
import { Logo } from '../ui/logo';
import { useToast } from '../ui/toast';

/**
 * Запрос восстановления пароля (ADR-043). После отправки ВСЕГДА показывается
 * успех-состояние — существование аккаунта не раскрывается.
 */
export function ForgotPasswordScreen() {
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!email.trim()) {
      setError(copy.errorFieldRequired);
      return;
    }
    const parsed = ForgotPasswordDtoSchema.safeParse({ email });
    if (!parsed.success) {
      setError(copy.errorEmailInvalid);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      await forgotPassword(parsed.data);
      setSent(true);
    } catch (err) {
      if (isApiError(err) && err.code === 'RATE_LIMITED') {
        showToast(copy.error429, 'error');
      } else if (isApiError(err) && err.code === 'NETWORK') {
        showToast(copy.errorNetwork, 'error');
      } else if (isApiError(err) && err.code === 'VALIDATION_ERROR') {
        setError(copy.errorEmailInvalid);
      } else {
        showToast(copy.errorServer, 'error');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-6">
      <div className="w-full max-w-[400px]">
        <Logo className="mb-8 text-22" />

        {sent ? (
          <div>
            <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal">
              {copy.forgotSuccessTitle}
            </h1>
            <p className="m-0 mb-6 text-14 text-ink-muted">{copy.forgotSuccess}</p>
            <Link href="/login" className="text-14 text-accent hover:underline">
              {copy.forgotBackToLogin}
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal">
              {copy.forgotTitle}
            </h1>
            <p className="m-0 mb-6 text-14 text-ink-muted">{copy.forgotSub}</p>

            <Field label={copy.fieldEmailLabel} htmlFor="forgot-email" error={error}>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                placeholder={copy.fieldEmailPlaceholder}
                value={email}
                error={error}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <button
              type="submit"
              disabled={pending}
              className="w-full cursor-pointer rounded-md bg-accent px-5 py-[13px] text-14 leading-none font-medium text-ink-on-accent transition-colors duration-[120ms] hover:bg-accent-hover active:bg-accent-down disabled:cursor-not-allowed disabled:opacity-60"
            >
              {copy.forgotSubmit}
            </button>

            <p className="mt-4 text-13">
              <Link href="/login" className="text-accent hover:underline">
                {copy.forgotBackToLogin}
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
