'use client';

import type { CompanyMeResponse, ToneOfVoice } from '@replydesk/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { isApiError } from '@/lib/api/client';
import { updateCompany } from '@/lib/api/endpoints';
import { copy, settingsPlanNote, usageBarAria } from '@/lib/copy';
import { periodPrepositional, periodResetDate, planLabel } from '@/lib/format';
import { COMPANY_ME_KEY, useCompanyMe } from '@/lib/hooks';
import { nicheLabels } from '@/lib/labels';
import { Button } from '../ui/button';
import { CountedTextarea, Field, Input, Select } from '../ui/field';
import { useToast } from '../ui/toast';

/** Тон «Уверенный» = значение premium в API (ADR-021). */
const TONES: ReadonlyArray<{ value: ToneOfVoice['tone']; name: string; short: string }> = [
  { value: 'soft', name: copy.toneSoftName, short: copy.settingsToneSoftShort },
  { value: 'neutral', name: copy.toneNeutralName, short: copy.settingsToneNeutralShort },
  { value: 'premium', name: copy.toneConfidentName, short: copy.settingsToneConfidentShort },
];

const SAMPLE_LABELS = [copy.onbSample1Label, copy.onbSample2Label, copy.onbSample3Label];
const SAMPLE_MAX = 1000;

export function SettingsPage() {
  const { data: company } = useCompanyMe();
  if (!company) return <div aria-busy="true" />;
  return <SettingsForm key={company.id} company={company} />;
}

function SettingsForm({ company }: { company: CompanyMeResponse }) {
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [name, setName] = useState(company.name);
  const [tone, setTone] = useState<ToneOfVoice['tone']>(company.toneOfVoice.tone);
  const [avoid, setAvoid] = useState(company.toneOfVoice.avoid ?? '');
  const [samples, setSamples] = useState<string[]>([
    company.toneOfVoice.examples[0] ?? '',
    company.toneOfVoice.examples[1] ?? '',
    company.toneOfVoice.examples[2] ?? '',
  ]);
  const [nameError, setNameError] = useState<string | null>(null);

  const sampleErrors = samples.map((s) => (s.length > SAMPLE_MAX ? copy.errorSampleTooLong : null));

  const mutation = useMutation({
    mutationFn: updateCompany,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: COMPANY_ME_KEY });
      showToast(copy.toastSettingsSaved);
    },
    onError: (err) => {
      if (isApiError(err) && err.code === 'NETWORK') showToast(copy.errorNetwork, 'error');
      else showToast(copy.toastSaveError, 'error');
    },
  });

  const save = (): void => {
    if (!name.trim()) {
      setNameError(copy.errorFieldRequired);
      return;
    }
    if (sampleErrors.some(Boolean)) return;
    setNameError(null);
    mutation.mutate({
      name: name.trim(),
      toneOfVoice: {
        tone,
        examples: samples.map((s) => s.trim()).filter(Boolean),
        ...(avoid.trim() ? { avoid: avoid.trim() } : {}),
      },
    });
  };

  const usage = company.usage;
  const pct = usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 0;

  return (
    <section className="max-w-[720px]">
      <h1 className="m-0 mb-2 font-display text-28 leading-tight font-normal min-[881px]:text-36">
        {copy.settingsTitle}
      </h1>
      <p className="m-0 mb-8 text-14 text-ink-muted">{copy.settingsSub}</p>

      {/* Компания */}
      <div className="mb-6 rounded-lg border border-line bg-surface p-6 shadow-2">
        <h2 className="m-0 mb-4 font-display text-22 font-normal">{copy.settingsCompanyTitle}</h2>
        <Field label={copy.settingsCompanyNameLabel} htmlFor="set-name" error={nameError}>
          <Input
            id="set-name"
            value={name}
            error={nameError}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label={copy.settingsNicheLabel} htmlFor="set-niche" hint={copy.settingsNicheHint}>
          {/* Ниша через PATCH /company/me не меняется (контракт, ADR-018) */}
          <Select id="set-niche" value={company.niche} disabled>
            <option value={company.niche}>{nicheLabels[company.niche]}</option>
          </Select>
        </Field>
      </div>

      {/* Тон бренда */}
      <div className="mb-6 rounded-lg border border-line bg-surface p-6 shadow-2">
        <h2 className="m-0 mb-4 font-display text-22 font-normal">{copy.settingsToneTitle}</h2>
        <div className="mb-4 flex flex-col gap-1">
          <span className="text-13 font-medium text-ink-muted" id="set-tone-label">
            {copy.settingsToneLabel}
          </span>
          <div
            className="mt-2 grid grid-cols-1 gap-3 min-[881px]:grid-cols-3"
            role="radiogroup"
            aria-labelledby="set-tone-label"
          >
            {TONES.map((t) => (
              <label key={t.value} className="relative">
                <input
                  type="radio"
                  name="set-tone"
                  className="peer absolute inset-0 cursor-pointer opacity-0"
                  checked={tone === t.value}
                  onChange={() => setTone(t.value)}
                />
                <span
                  className={`block h-full rounded-md border px-4 py-3 transition-colors duration-[120ms] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                    tone === t.value
                      ? 'border-accent bg-accent-dim'
                      : 'border-line-strong hover:border-ink-faint'
                  }`}
                >
                  <b className="mb-0.5 block text-14 font-semibold">{t.name}</b>
                  <span className="text-13 text-ink-muted">{t.short}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <Field label={copy.settingsAvoidLabel} htmlFor="set-avoid">
          <Input
            id="set-avoid"
            value={avoid}
            maxLength={1000}
            placeholder={copy.onbAvoidPlaceholder}
            onChange={(e) => setAvoid(e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-1">
          <span className="mb-1 text-13 font-medium text-ink-muted">
            {copy.settingsSamplesLabel}
          </span>
          {/* Три поля примеров, как в онбординге (ADR-010) */}
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
          <p className="m-0 text-13 text-ink-faint">{copy.settingsSamplesHint}</p>
        </div>
      </div>

      {/* Тариф */}
      <div className="mb-6 rounded-lg border border-line bg-surface p-6 shadow-2">
        <h2 className="m-0 mb-4 font-display text-22 font-normal">{copy.settingsPlanTitle}</h2>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="font-display text-48 leading-none">
            {usage.used}{' '}
            <small className="font-text text-14 text-ink-muted">
              из {usage.limit} генераций в {periodPrepositional(usage.period)}
            </small>
          </div>
          <div
            className="h-1.5 flex-1 basis-[200px] overflow-hidden rounded-[3px] bg-line"
            role="img"
            aria-label={usageBarAria(usage.used, usage.limit)}
          >
            <i className="block h-full rounded-[3px] bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="m-0 mt-2 w-full text-13 text-ink-faint">
            {settingsPlanNote(planLabel(company.plan), periodResetDate(usage.period))}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button
          variant="primary"
          disabled={mutation.isPending || sampleErrors.some(Boolean)}
          onClick={save}
        >
          {copy.settingsSave}
        </Button>
        <span className="text-13 text-ink-faint">{copy.settingsSaveNote}</span>
      </div>
    </section>
  );
}
