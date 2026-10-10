import { useEffect, useState } from 'react';
import type { ProviderId, Settings } from '../lib/types';

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

interface Status {
  claudeCode?: { installed: boolean; version: string | null };
  anthropic?: { keyDetected: boolean };
  ollama?: { reachable: boolean; models: string[]; error?: string };
}

const PROVIDERS: { id: ProviderId; label: string; detail: string }[] = [
  { id: 'basic', label: 'ساده (آفلاین، بدون AI)', detail: 'هر خط یا بلوک «Column: value» ورودی را به یک ردیف تبدیل می‌کند. متن را تحلیل نمی‌کند، پس بیشتر سلول‌ها را باید دستی پر کنید.' },
  { id: 'claude-code', label: 'Claude Code (حساب همین سیستم)', detail: 'پیشنهادی. از Claude Code که در این سیستم وارد آن شده‌اید استفاده می‌کند و مصرف از همان حساب کم می‌شود. کلید API لازم نیست.' },
  { id: 'anthropic', label: 'Claude (Anthropic API)', detail: 'به کلید API از Anthropic نیاز دارد (هزینه‌دار).' },
  { id: 'ollama', label: 'مدل محلی (Ollama)', detail: 'رایگان و کاملاً آفلاین. کیفیت به مدلی که اجرا می‌کنید بستگی دارد.' },
];

export function SettingsDialog({ settings, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(settings);
  const [status, setStatus] = useState<Status | null>(null);
  const [checking, setChecking] = useState(false);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const check = async () => {
    setChecking(true);
    try {
      const qs =
        draft.provider === 'ollama' ? `?ollamaBaseUrl=${encodeURIComponent(draft.ollamaBaseUrl)}` : draft.provider === 'claude-code' ? '?claudeCode=1' : '';
      const res = await fetch(`/api/ai/status${qs}`);
      setStatus(res.ok ? ((await res.json()) as Status) : null);
    } catch {
      setStatus(null);
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (draft.provider !== 'basic') void check();
    // Only re-check when the provider changes.
  }, [draft.provider]);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2 id="settings-title">تنظیمات</h2>
        <fieldset className="providers">
          <legend>Seed Data با چه روشی ساخته شود؟</legend>
          {PROVIDERS.map((p) => (
            <label key={p.id} className={`provider ${draft.provider === p.id ? 'selected' : ''}`}>
              <input type="radio" name="provider" checked={draft.provider === p.id} onChange={() => set('provider', p.id)} />
              <span>
                <strong>{p.label}</strong>
                <small>{p.detail}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {draft.provider === 'claude-code' && (
          <div className="stack">
            <label className="field">
              <span>
                مدل <small>اختیاری، مثلاً opus یا sonnet؛ خالی = مدل پیش‌فرض Claude Code</small>
              </span>
              <input className="mono" value={draft.claudeCodeModel} placeholder="پیش‌فرض Claude Code" dir="ltr" onChange={(e) => set('claudeCodeModel', e.target.value.trim())} />
            </label>
            <StatusLine
              checking={checking}
              ok={status?.claudeCode?.installed}
              okText={`Claude Code پیدا شد${status?.claudeCode?.version ? ` (${status.claudeCode.version})` : ''}.`}
              badText="Claude Code روی این سیستم پیدا نشد."
            />
            <button type="button" className="btn btn-sm" onClick={check} disabled={checking}>
              بررسی اتصال
            </button>
            <div className="howto">
              <b>راه‌اندازی (یک بار):</b>
              <ol>
                <li>
                  Claude Code را نصب کنید و یک بار دستور <span className="mono">claude</span> را در ترمینال اجرا کنید تا وارد حساب شوید.
                </li>
                <li>
                  اگر <span className="mono">claude</span> در PATH نیست، مقدار <span className="mono">CLAUDE_CODE_PATH</span> را در <span className="mono">.env.local</span> تنظیم کنید و{' '}
                  <span className="mono">npm run dev</span> را دوباره اجرا کنید.
                </li>
              </ol>
              <p className="hint">سرور محلی Claude Code را با ابزارهای خاموش اجرا می‌کند و فقط استاندارد، ستون‌ها و ورودی همین درخواست ارسال می‌شود.</p>
            </div>
          </div>
        )}

        {draft.provider === 'anthropic' && (
          <div className="stack">
            <label className="field">
              <span>مدل</span>
              <input className="mono" dir="ltr" value={draft.anthropicModel} onChange={(e) => set('anthropicModel', e.target.value)} />
            </label>
            <StatusLine
              checking={checking}
              ok={status?.anthropic?.keyDetected}
              okText="کلید API روی سرور محلی پیدا شد."
              badText="کلید API پیدا نشد."
            />
            <div className="howto">
              <b>راه‌اندازی (یک بار):</b>
              <ol>
                <li>
                  در <span className="mono">console.anthropic.com</span> یک کلید بسازید.
                </li>
                <li>
                  در پوشهٔ پروژه، <span className="mono">.env.example</span> را به <span className="mono">.env.local</span> کپی کنید و{' '}
                  <span className="mono">ANTHROPIC_API_KEY</span> را وارد کنید.
                </li>
                <li>
                  <span className="mono">npm run dev</span> را دوباره اجرا کنید.
                </li>
              </ol>
              <p className="hint">کلید فقط روی سیستم شما و در سرور محلی می‌ماند و به مرورگر فرستاده یا در برنامه ذخیره نمی‌شود.</p>
            </div>
          </div>
        )}

        {draft.provider === 'ollama' && (
          <div className="stack">
            <div className="rules-grid">
              <label className="field">
                <span>آدرس Ollama</span>
                <input className="mono" dir="ltr" value={draft.ollamaBaseUrl} onChange={(e) => set('ollamaBaseUrl', e.target.value)} />
              </label>
              <label className="field">
                <span>مدل</span>
                <input className="mono" dir="ltr" value={draft.ollamaModel} onChange={(e) => set('ollamaModel', e.target.value)} list="ollama-models" />
                <datalist id="ollama-models">
                  {status?.ollama?.models.map((m) => <option key={m} value={m} />)}
                </datalist>
              </label>
            </div>
            <StatusLine
              checking={checking}
              ok={status?.ollama?.reachable}
              okText={`Ollama در حال اجراست${status?.ollama?.models.length ? ` (${status.ollama.models.length} مدل نصب شده)` : ''}.`}
              badText="Ollama در این آدرس در دسترس نیست."
            />
            <button type="button" className="btn btn-sm" onClick={check} disabled={checking}>
              بررسی اتصال
            </button>
            <div className="howto">
              <b>راه‌اندازی (یک بار):</b> Ollama را از <span className="mono">ollama.com</span> نصب کنید و دستور <span className="mono" dir="ltr">ollama pull {draft.ollamaModel || 'llama3.1'}</span> را اجرا کنید.
            </div>
          </div>
        )}

        {draft.provider !== 'basic' && (
          <label className="field narrow">
            <span>زمان انتظار (ثانیه)</span>
            <input type="number" min={10} max={600} value={draft.timeoutSeconds} onChange={(e) => set('timeoutSeconds', Math.min(600, Math.max(10, Number(e.target.value) || 120)))} />
          </label>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            انصراف
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            ذخیرهٔ تنظیمات
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusLine({ checking, ok, okText, badText }: { checking: boolean; ok?: boolean; okText: string; badText: string }) {
  if (checking) return <p className="status-line">در حال بررسی…</p>;
  if (ok === undefined) return null;
  return <p className={`status-line ${ok ? 'ok' : 'bad'}`}>{ok ? `✓ ${okText}` : `✗ ${badText}`}</p>;
}
