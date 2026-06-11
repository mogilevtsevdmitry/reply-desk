'use client';

import { useRef, useState } from 'react';
import { copy } from '@/lib/copy';
import { Button } from './button';
import { useToast } from './toast';

/**
 * Кнопка копирования: navigator.clipboard + тост «Скопировано в буфер обмена»
 * и inline-подтверждение «Скопировано» рядом с кнопкой (COPY.md, блок 8).
 */
export function CopyButton({ label, getText }: { label: string; getText: () => string }) {
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(getText());
    } catch {
      showToast(copy.toastSaveError, 'error');
      return;
    }
    showToast(copy.toastCopied);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" onClick={() => void handleCopy()}>
        {label}
      </Button>
      {copied ? <span className="text-13 text-ok">{copy.copiedInline}</span> : null}
    </div>
  );
}
