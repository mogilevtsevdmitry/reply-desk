'use client';

import { NicheSchema, type Niche, type ToneOfVoice } from '@replydesk/contracts';
import { useState } from 'react';
import { isApiError } from '@/lib/api/client';
import { createCompany } from '@/lib/api/endpoints';
import { useAuth } from '@/lib/auth/auth-context';
import { copy } from '@/lib/copy';
import { nicheLabels } from '@/lib/labels';
import { Button } from '../ui/button';
import { CountedTextarea, Field, Input } from '../ui/field';
import { Logo } from '../ui/logo';
import { useToast } from '../ui/toast';

/**
 * Тон «Уверенный» отправляется в API значением `premium` (ADR-021):
 * контракт ToneOfVoice.tone = soft | neutral | premium.
 */
const TONES: ReadonlyArray<{ value: ToneOfVoice['tone']; name: string; desc: string }> = [
  { value: 'soft', name: copy.toneSoftName, desc: copy.toneSoftDesc },
  { value: 'neutral', name: copy.toneNeutralName, desc: copy.toneNeutralDesc },
  { value: 'premium', name: copy.toneConfidentName, desc: copy.toneConfidentDesc },
];

const STEPS = [copy.onbStep1Name, copy.onbStep2Name, copy.onbStep3Name];
const SAMPLE_LABELS = [copy.onbSample1Label, copy.onbSample2Label, copy.onbSample3Label];
const SAMPLE_MAX = 1000;

export function OnboardingWizard() {
  const { setSession } = useAuth();
  const { showToast } = useToast();
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [niche, setNiche] = useState<Niche>('SALON');
  const [tone, setTone] = useState<ToneOfVoice['tone']>('neutral');
  const [avoid, setAvoid] = useState('');
  const [samples, setSamples] = useState<string[]>(['', '', '']);
  const [nameError, setNameError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const sampleErrors = samples.map((s) => (s.length > SAMPLE_MAX ? copy.errorSampleTooLong : null));

  const next = (): void => {
    if (step === 0 && !name.trim()) {
      setNameError(copy.errorFieldRequired);
      return;
    }
    setNameError(null);
    setStep((s) => Math.min(s + 1, 2));
  };

  const finish = async (): Promise<void> => {
    if (sampleErrors.some(Boolean)) return;
    setPending(true);
    try {
      const { accessToken } = await createCompany({
        name: name.trim(),
        niche,
        toneOfVoice: {
          tone,
          examples: samples.map((s) => s.trim()).filter(Boolean),
          ...(avoid.trim() ? { avoid: avoid.trim() } : {}),
        },
      });
      // ADR-005: заменить access-токен в памяти ДО redirect в /app
      // (redirect выполнит гард RequireOnboarding по обновлённому companyId).
      setSession(accessToken);
    } catch (err) {
      if (isApiError(err) && err.code === 'NETWORK') showToast(copy.errorNetwork, 'error');
      else if (isApiError(err) && err.code === 'RATE_LIMITED') showToast(copy.error429, 'error');
      else showToast(copy.toastSaveError, 'error');
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center px-4 pt-8 pb-16">
      <div className="mb-12">
        <Logo />
      </div>

      <div className="w-full max-w-[560px]">
        {/* Степпер */}
        <div className="mb-8 flex items-center gap-2" aria-label={copy.onbStepperAria}>
          {STEPS.map((stepName, i) => (
            <StepperItem key={stepName} index={i} current={step} name={stepName} />
          ))}
        </div>

        {/* Панель шага: подъём 8px + fade 240 мс при смене (MOTION.md) */}
        <section
          key={step}
          className="step-enter rounded-lg border border-line bg-surface p-6 shadow-2"
        >
          {step === 0 ? (
            <>
              <StepTitle title={copy.onb1Title} sub={copy.onb1Sub} />
              <Field label={copy.onbCompanyLabel} htmlFor="onb-company" error={nameError}>
                <Input
                  id="onb-company"
                  value={name}
                  error={nameError}
                  placeholder={copy.onbCompanyPlaceholder}
                  maxLength={200}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (nameError && e.target.value.trim()) setNameError(null);
                  }}
                />
              </Field>
              <RadioChips
                label={copy.onbNicheLabel}
                hint={copy.onbNicheHint}
                name="niche"
                value={niche}
                options={NicheSchema.options.map((n) => ({ value: n, label: nicheLabels[n] }))}
                onChange={(v) => setNiche(v)}
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <StepTitle title={copy.onb2Title} sub={copy.onb2Sub} />
              <div className="mb-4 flex flex-col gap-1">
                <span className="text-13 font-medium text-ink-muted" id="onb-tone-label">
                  {copy.onbToneLabel}
                </span>
                <div className="mt-2 grid gap-3" role="radiogroup" aria-labelledby="onb-tone-label">
                  {TONES.map((t) => (
                    <label key={t.value} className="relative">
                      <input
                        type="radio"
                        name="tone"
                        className="peer absolute inset-0 cursor-pointer opacity-0"
                        checked={tone === t.value}
                        onChange={() => setTone(t.value)}
                      />
                      <span
                        className={`block rounded-md border p-4 transition-colors duration-[120ms] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                          tone === t.value
                            ? 'border-accent bg-accent-dim'
                            : 'border-line-strong hover:border-ink-faint'
                        }`}
                      >
                        <b className="mb-0.5 block text-14 font-semibold">{t.name}</b>
                        <span className="text-13 text-ink-muted">{t.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <Field label={copy.onbAvoidLabel} htmlFor="onb-avoid">
                <Input
                  id="onb-avoid"
                  value={avoid}
                  maxLength={1000}
                  placeholder={copy.onbAvoidPlaceholder}
                  onChange={(e) => setAvoid(e.target.value)}
                />
              </Field>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <StepTitle title={copy.onb3Title} sub={copy.onb3Sub} />
              {/* Три отдельных поля примеров по 1000 символов (ADR-010) */}
              {samples.map((sample, i) => (
                <CountedTextarea
                  key={SAMPLE_LABELS[i] ?? i}
                  label={SAMPLE_LABELS[i] ?? ''}
                  max={SAMPLE_MAX}
                  value={sample}
                  error={sampleErrors[i]}
                  placeholder={i === 0 ? copy.onbSamplePlaceholder : undefined}
                  onChange={(e) =>
                    setSamples((prev) => prev.map((s, j) => (j === i ? e.target.value : s)))
                  }
                />
              ))}
              <p className="m-0 text-13 text-ink-faint">{copy.onb3Hint}</p>
            </>
          ) : null}
        </section>

        <div className="mt-6 flex justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setStep((s) => Math.max(s - 1, 0))}
            className={step === 0 ? 'invisible' : ''}
          >
            {copy.onbBack}
          </Button>
          {step < 2 ? (
            <Button variant="primary" onClick={next}>
              {copy.onbNext}
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={pending || sampleErrors.some(Boolean)}
              onClick={() => void finish()}
            >
              {copy.onbFinish}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function StepTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <>
      <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal">{title}</h1>
      <p className="m-0 mb-6 text-14 text-ink-muted">{sub}</p>
    </>
  );
}

function StepperItem({ index, current, name }: { index: number; current: number; name: string }) {
  const isCurrent = index === current;
  const isDone = index < current;
  return (
    <>
      {index > 0 ? <div className="h-px flex-1 bg-line" aria-hidden="true" /> : null}
      <div
        className={`flex items-center gap-2 text-13 ${isCurrent ? 'text-ink' : 'text-ink-faint'}`}
        aria-current={isCurrent ? 'step' : undefined}
      >
        <span
          className={`grid h-[26px] w-[26px] place-items-center rounded-full border font-display text-13 transition-colors duration-[240ms] ${
            isDone
              ? 'border-accent bg-accent text-ink-on-accent'
              : isCurrent
                ? 'border-accent text-accent shadow-glow-accent'
                : 'border-line-strong'
          }`}
        >
          {isDone ? '✓' : index + 1}
        </span>
        <span className="hidden min-[720px]:inline">{name}</span>
      </div>
    </>
  );
}

function RadioChips<T extends string>({
  label,
  hint,
  name,
  value,
  options,
  onChange,
}: {
  label: string;
  hint?: string;
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; dotClass?: string }>;
  onChange: (value: T) => void;
}) {
  const labelId = `${name}-label`;
  return (
    <div className="mb-4 flex flex-col gap-1">
      <span className="text-13 font-medium text-ink-muted" id={labelId}>
        {label}
      </span>
      <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-labelledby={labelId}>
        {options.map((opt) => (
          <label key={opt.value} className="relative">
            <input
              type="radio"
              name={name}
              className="peer absolute inset-0 cursor-pointer opacity-0"
              checked={value === opt.value}
              onChange={() => onChange(opt.value)}
            />
            <span
              className={`inline-flex items-center gap-1.5 rounded-pill border px-3.5 py-2 text-14 transition-colors duration-[120ms] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                value === opt.value
                  ? 'border-accent bg-accent-dim text-accent'
                  : 'border-line-strong text-ink-muted hover:border-ink-faint hover:text-ink'
              }`}
            >
              {opt.dotClass ? (
                <i className={`h-2 w-2 rounded-full ${opt.dotClass}`} aria-hidden="true" />
              ) : null}
              {opt.label}
            </span>
          </label>
        ))}
      </div>
      {hint ? <p className="mt-1 text-13 text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export { RadioChips };
