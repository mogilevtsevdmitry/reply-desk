'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { isApiError } from '@/lib/api/client';
import { resetPassword } from '@/lib/api/endpoints';
import { copy } from '@/lib/copy';
import { Field, Input } from '../ui/field';
import { Logo } from '../ui/logo';
import { useToast } from '../ui/toast';

interface FieldErrors {
  password?: string;
  repeat?: string;
}

/**
 * Смена пароля по токену из письма (ADR-043). Состояния:
 * - форма (новый пароль + повтор, клиентская валидация длины и совпадения);
 * - успех → ссылка на /login (все сессии разлогинены);
 * - невалидный токен (нет в URL / 422 INVALID_TOKEN) → ссылка на /forgot-password.
 */
export function ResetPasswordScreen({ token }: { token: string }) {
  const { showToast } = useToast();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<'form' | 'done' | 'invalid'>(token ? 'form' : 'invalid');

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fieldErrors: FieldErrors = {};
    if (!password) fieldErrors.password = copy.errorFieldRequired;
    else if (password.length < 8) fieldErrors.password = copy.errorPasswordShort;
    if (password && repeat !== password) fieldErrors.repeat = copy.errorPasswordsMismatch;
    setErrors(fieldErrors);
    if (fieldErrors.password || fieldErrors.repeat) return;

    setPending(true);
    try {
      await resetPassword({ token, password });
      setState('done');
    } catch (err) {
      if (isApiError(err) && err.code === 'INVALID_TOKEN') {
        setState('invalid');
      } else if (isApiError(err) && err.code === 'RATE_LIMITED') {
        showToast(copy.error429, 'error');
      } else if (isApiError(err) && err.code === 'NETWORK') {
        showToast(copy.errorNetwork, 'error');
      } else if (isApiError(err) && err.code === 'VALIDATION_ERROR') {
        setErrors({ password: copy.errorPasswordShort });
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

        {state === 'done' ? (
          <div>
            <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal">
              {copy.resetSuccessTitle}
            </h1>
            <p className="m-0 mb-6 text-14 text-ink-muted">{copy.resetSuccess}</p>
            <Link href="/login" className="text-14 text-accent hover:underline">
              {copy.resetSuccessLoginLink}
            </Link>
          </div>
        ) : state === 'invalid' ? (
          <div>
            <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal">
              {copy.resetInvalidTokenTitle}
            </h1>
            <p className="m-0 mb-6 text-14 text-ink-muted">{copy.resetInvalidToken}</p>
            <Link href="/forgot-password" className="text-14 text-accent hover:underline">
              {copy.resetRequestNewLink}
            </Link>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal">
              {copy.resetTitle}
            </h1>
            <p className="m-0 mb-6 text-14 text-ink-muted">{copy.resetSub}</p>

            <Field
              label={copy.resetPasswordLabel}
              htmlFor="reset-password"
              error={errors.password}
              hint={copy.signupPasswordHint}
            >
              <Input
                id="reset-password"
                type="password"
                autoComplete="new-password"
                placeholder={copy.signupPasswordPlaceholder}
                value={password}
                error={errors.password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            <Field
              label={copy.resetPasswordRepeatLabel}
              htmlFor="reset-password-repeat"
              error={errors.repeat}
            >
              <Input
                id="reset-password-repeat"
                type="password"
                autoComplete="new-password"
                placeholder={copy.signupPasswordPlaceholder}
                value={repeat}
                error={errors.repeat}
                onChange={(e) => setRepeat(e.target.value)}
              />
            </Field>

            <button
              type="submit"
              disabled={pending}
              className="w-full cursor-pointer rounded-md bg-accent px-5 py-[13px] text-14 leading-none font-medium text-ink-on-accent transition-colors duration-[120ms] hover:bg-accent-hover active:bg-accent-down disabled:cursor-not-allowed disabled:opacity-60"
            >
              {copy.resetSubmit}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
