'use client';

import { CredentialsSchema } from '@replydesk/contracts';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { isApiError } from '@/lib/api/client';
import { login, register } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/auth-context';
import { copy } from '@/lib/copy';
import { Field, Input } from '../ui/field';
import { Logo } from '../ui/logo';
import { useToast } from '../ui/toast';

type Mode = 'login' | 'signup';

interface FieldErrors {
  email?: string;
  password?: string;
  form?: string;
}

/** Клиентская валидация по схеме контрактов, тексты ошибок — из COPY.md. */
function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  if (!email.trim()) errors.email = copy.errorFieldRequired;
  if (!password) errors.password = copy.errorFieldRequired;
  if (!errors.email || !errors.password) {
    const parsed = CredentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'email' && !errors.email) errors.email = copy.errorEmailInvalid;
        if (field === 'password' && !errors.password) {
          errors.password =
            issue.code === 'too_small' ? copy.errorPasswordShort : copy.errorEmailInvalid;
        }
      }
    }
  }
  return errors;
}

/** Ссылка на юридический документ из текста согласия — открывается в новой вкладке. */
function LegalLink({ slug, children }: { slug: string; children: string }) {
  return (
    <a
      href={`/legal/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline"
    >
      {children}
    </a>
  );
}

export function AuthScreen({ mode }: { mode: Mode }) {
  const { setSession } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Два РАЗДЕЛЬНЫХ согласия (152-ФЗ): соглашение+ПД и трансграничная передача в LLM
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptLlm, setAcceptLlm] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);

  const consentsMissing = mode === 'signup' && (!acceptTerms || !acceptLlm);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const fieldErrors = validate(email, password);
    if (consentsMissing) fieldErrors.form = copy.errorConsentRequired;
    setErrors(fieldErrors);
    if (fieldErrors.email || fieldErrors.password || fieldErrors.form) return;

    setPending(true);
    try {
      const credentials = CredentialsSchema.parse({ email, password });
      if (mode === 'signup') {
        // Контракт требует literal(true) — сюда попадаем только с двумя отметками
        await register({ ...credentials, acceptTerms: true, acceptLlm: true });
      }
      const { accessToken } = await login(credentials);
      setSession(accessToken, credentials.email);
      // Редирект делает гард GuestOnly (authed → /onboarding | /app)
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === 'EMAIL_TAKEN') {
          setErrors({ email: copy.errorEmailTaken });
        } else if (err.code === 'INVALID_CREDENTIALS' || err.status === 401) {
          setErrors({ form: copy.errorCredentials });
        } else if (err.code === 'RATE_LIMITED') {
          showToast(copy.error429, 'error');
        } else if (err.code === 'NETWORK') {
          showToast(copy.errorNetwork, 'error');
        } else if (err.code === 'VALIDATION_ERROR') {
          setErrors({ form: err.message });
        } else {
          showToast(copy.errorServer, 'error');
        }
      } else {
        showToast(copy.errorServer, 'error');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-1 min-[881px]:grid-cols-2">
      {/* Брендовая панель */}
      <aside
        className="flex flex-col justify-between gap-6 border-b border-line p-6 min-[881px]:border-r min-[881px]:border-b-0 min-[881px]:p-12"
        style={{
          background:
            'radial-gradient(1200px 600px at -10% 110%, var(--color-accent-dim), transparent 60%)',
        }}
      >
        <Logo className="text-22" />
        <div>
          {/* Декоративная «гребёнка» — фирменный след сейсмографа */}
          <div className="mb-4 flex h-8 items-end gap-1.5 min-[881px]:mb-6 min-[881px]:h-12" aria-hidden="true">
            <i className="w-1.5 rounded-[3px] bg-sev-1" style={{ height: '25%' }} />
            <i className="w-1.5 rounded-[3px] bg-sev-2" style={{ height: '46%' }} />
            <i className="w-1.5 rounded-[3px] bg-sev-3" style={{ height: '62%' }} />
            <i className="w-1.5 rounded-[3px] bg-sev-4" style={{ height: '83%' }} />
            <i className="w-1.5 rounded-[3px] bg-sev-5" style={{ height: '100%' }} />
          </div>
          <h1 className="m-0 mb-4 max-w-[18ch] font-display text-28 leading-tight font-normal min-[881px]:text-36">
            {copy.authBrandHeadline}
          </h1>
          <p className="m-0 max-w-[42ch] text-ink-muted">{copy.authBrandSub}</p>
        </div>
        <div className="hidden text-13 text-ink-faint min-[881px]:block">
          {copy.authBrandPlatforms}
        </div>
      </aside>

      {/* Форма */}
      <main className="flex items-center justify-center px-4 py-6 min-[881px]:px-6 min-[881px]:py-8">
        <div className="w-full max-w-[400px]">
          <div
            role="tablist"
            aria-label={copy.authTabsAria}
            className="mb-6 flex gap-[2px] rounded-md border border-line bg-surface p-[3px]"
          >
            <Link
              role="tab"
              aria-selected={mode === 'login'}
              href="/login"
              className={`flex-1 rounded-sm px-4 py-2 text-center text-14 font-medium transition-colors duration-[120ms] ${
                mode === 'login' ? 'bg-surface-2 text-ink shadow-1' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {copy.authTabLogin}
            </Link>
            <Link
              role="tab"
              aria-selected={mode === 'signup'}
              href="/register"
              className={`flex-1 rounded-sm px-4 py-2 text-center text-14 font-medium transition-colors duration-[120ms] ${
                mode === 'signup' ? 'bg-surface-2 text-ink shadow-1' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {copy.authTabSignup}
            </Link>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} noValidate>
            <h2 className="m-0 mb-2 font-display text-28 leading-tight font-normal">
              {mode === 'login' ? copy.loginTitle : copy.signupTitle}
            </h2>
            <p className="m-0 mb-6 text-14 text-ink-muted">
              {mode === 'login' ? copy.loginSub : copy.signupSub}
            </p>

            <Field label={copy.fieldEmailLabel} htmlFor="auth-email" error={errors.email}>
              <Input
                id="auth-email"
                type="email"
                autoComplete="email"
                placeholder={copy.fieldEmailPlaceholder}
                value={email}
                error={errors.email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            <Field
              label={copy.fieldPasswordLabel}
              htmlFor="auth-password"
              error={errors.password}
              hint={mode === 'signup' ? copy.signupPasswordHint : undefined}
            >
              <Input
                id="auth-password"
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder={
                  mode === 'login' ? copy.loginPasswordPlaceholder : copy.signupPasswordPlaceholder
                }
                value={password}
                error={errors.password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {mode === 'signup' ? (
              <div className="mb-5 flex flex-col gap-3">
                {/* Чекбокс 1: соглашение + политика + согласие на обработку ПД */}
                <label className="flex cursor-pointer items-start gap-2.5 text-13 leading-normal text-ink-muted">
                  <input
                    type="checkbox"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-(--color-accent)"
                  />
                  <span>
                    {copy.signupAcceptPrefix} <LegalLink slug="terms-of-service">{copy.signupAcceptTosLink}</LegalLink>{' '}
                    {copy.signupAcceptAnd}{' '}
                    <LegalLink slug="privacy-policy">{copy.signupAcceptPrivacyLink}</LegalLink>
                    {copy.signupAcceptGive}{' '}
                    <LegalLink slug="consent-pd">{copy.signupAcceptPdLink}</LegalLink>
                  </span>
                </label>

                {/* Чекбокс 2: ОТДЕЛЬНОЕ согласие на трансграничную передачу в LLM */}
                <label className="flex cursor-pointer items-start gap-2.5 text-13 leading-normal text-ink-muted">
                  <input
                    type="checkbox"
                    checked={acceptLlm}
                    onChange={(e) => setAcceptLlm(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 cursor-pointer accent-(--color-accent)"
                  />
                  <span>
                    {copy.signupLlmPrefix} <LegalLink slug="consent-llm">{copy.signupLlmLink}</LegalLink>
                  </span>
                </label>

                <p className="m-0 text-12 leading-normal text-ink-faint">{copy.signupLlmNote}</p>
              </div>
            ) : null}

            {errors.form ? (
              <p role="alert" className="mb-4 text-13 text-danger">
                {errors.form}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={pending || consentsMissing}
              className="w-full cursor-pointer rounded-md bg-accent px-5 py-[13px] text-14 leading-none font-medium text-ink-on-accent transition-colors duration-[120ms] hover:bg-accent-hover active:bg-accent-down disabled:cursor-not-allowed disabled:opacity-60"
            >
              {mode === 'login' ? copy.loginSubmit : copy.signupSubmit}
            </button>

            <p className="mt-4 text-13 text-ink-muted">
              {mode === 'login' ? copy.loginSwitchText : copy.signupSwitchText}{' '}
              <Link
                href={mode === 'login' ? '/register' : '/login'}
                className="text-accent hover:underline"
              >
                {mode === 'login' ? copy.loginSwitchLink : copy.signupSwitchLink}
              </Link>
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
