import { useCallback, useRef, useState } from 'react';
import { fa } from '../lib/bidi';

interface Pending {
  elapsed: number;
}

/**
 * The question generateTable's `onSlow` asks: «still working after N seconds — keep waiting?».
 * `ask` is passed as onSlow; `settle` closes an open question when the generation ends on its own.
 */
export function useSlowConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const answer = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
  }, []);

  const ask = useCallback(
    (elapsed: number) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(true);
        resolver.current = resolve;
        setPending({ elapsed });
      }),
    [],
  );

  /** The generation finished, failed or was cancelled: drop the question (the answer no longer matters). */
  const settle = useCallback(() => answer(true), [answer]);

  return { pending, ask, answer, settle };
}

export function SlowGenerationPrompt({ pending, answer }: { pending: Pending | null; answer: (ok: boolean) => void }) {
  if (!pending) return null;
  return (
    <div className="slow-prompt" role="alertdialog" aria-label="ساخت طولانی شده است" dir="rtl">
      <p>
        <b>ساخت Seed Data بیش از {fa(pending.elapsed)} ثانیه طول کشیده است.</b> ادامه بدهم؟
        <br />
        <small>تا وقتی جواب ندهید، ساخت در پس‌زمینه ادامه دارد و اگر تمام شود نتیجه نمایش داده می‌شود.</small>
      </p>
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => answer(false)}>
          توقف ساخت
        </button>
        <button type="button" className="btn btn-primary" onClick={() => answer(true)}>
          ادامه
        </button>
      </div>
    </div>
  );
}
