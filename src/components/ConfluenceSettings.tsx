import { useState } from 'react';
import { confluenceApi, type ConfluenceStatus } from '../lib/seedJobsClient';
import { useDialogs } from './Dialogs';

type Api = typeof confluenceApi;

interface Props {
  status: ConfluenceStatus | null;
  onChange: (s: ConfluenceStatus) => void;
  /** Shown inside another flow (e.g. the generation modal): a short intro instead of the full heading. */
  compact?: boolean;
  api?: Api;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Confluence credentials: base URL, auth method, email (Cloud) and API token. The token is sent to the local server
 * once and stored there encrypted; afterwards the UI only shows it masked.
 */
export function ConfluenceSettings({ status, onChange, compact, api = confluenceApi }: Props) {
  const { confirm } = useDialogs();
  const [baseUrl, setBaseUrl] = useState(status?.baseUrl ?? 'https://confluence.snappfood.ir');
  const [authType, setAuthType] = useState<'bearer' | 'basic'>(status?.authType ?? 'bearer');
  const [email, setEmail] = useState(status?.email ?? '');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState<'test' | 'save' | 'remove' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const input = () => ({ baseUrl, authType, email: authType === 'basic' ? email : undefined, token: token.trim() || undefined });
  const savedInApp = status?.source === 'app';

  const act = async (kind: 'test' | 'save' | 'remove', fn: () => Promise<void>) => {
    setBusy(kind);
    setResult(null);
    try {
      await fn();
    } catch (err) {
      setResult({ ok: false, message: errText(err) });
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act('save', async () => {
      const test = await api.test(input());
      if (!test.ok) {
        setResult(test);
        return;
      }
      const next = await api.save(input());
      setToken('');
      setResult({ ok: true, message: `${test.message} تنظیمات ذخیره شد.` });
      onChange(next);
    });

  const remove = async () => {
    const ok = await confirm({ title: 'توکن Confluence حذف شود؟', message: 'توکن ذخیره‌شده در برنامه حذف می‌شود.', confirmLabel: 'حذف', danger: true });
    if (ok) await act('remove', async () => onChange(await api.remove()));
  };

  return (
    <div className={`confluence-settings ${compact ? 'compact' : ''}`}>
      {compact ? (
        <p className="hint warn">برای خواندن صفحات Confluence اول اتصال را تنظیم کنید. توکن فقط روی سرور محلی و به‌صورت رمزنگاری‌شده ذخیره می‌شود.</p>
      ) : (
        <p className={`status-line ${status?.tokenSet ? 'ok' : 'bad'}`}>
          {status?.tokenSet
            ? `✓ متصل به ${status.baseUrl}${status.source === 'env' ? ' (از .env.local)' : ''}${status.masked ? ` — توکن ${status.masked}` : ''}`
            : '✗ توکن Confluence تنظیم نشده است.'}
        </p>
      )}
      <div className="rules-grid">
        <label className="field">
          <span>آدرس Confluence</span>
          <input className="mono" dir="ltr" aria-label="آدرس Confluence" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://confluence.snappfood.ir" />
        </label>
        <label className="field">
          <span>روش ورود</span>
          <select aria-label="روش ورود" value={authType} onChange={(e) => setAuthType(e.target.value as 'bearer' | 'basic')}>
            <option value="bearer">Personal Access Token (Data Center)</option>
            <option value="basic">ایمیل + API Token (Cloud)</option>
          </select>
        </label>
        {authType === 'basic' && (
          <label className="field">
            <span>ایمیل</span>
            <input dir="ltr" type="email" aria-label="ایمیل" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}
        <label className="field">
          <span>
            توکن <small>Confluence → Profile → Personal Access Tokens</small>
          </span>
          <input
            className="mono"
            dir="ltr"
            type="password"
            autoComplete="new-password"
            aria-label="توکن Confluence"
            value={token}
            placeholder={savedInApp ? `ذخیره شده (${status?.masked}) — برای تغییر، مقدار جدید وارد کنید` : 'توکن را وارد کنید'}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
      </div>
      <div className="actions-row">
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() =>
            act('test', async () => {
              const r = await api.test(input());
              // A test alone does not store anything: say so, otherwise the connection looks ready when it is not.
              const unsaved = r.ok && (token.trim() || !status?.tokenSet);
              setResult(unsaved ? { ok: true, message: `${r.message} هنوز ذخیره نشده است؛ برای استفاده، «ذخیرهٔ تنظیمات Confluence» را بزنید.` } : r);
            })
          }
        >
          {busy === 'test' ? 'در حال بررسی…' : 'بررسی اتصال'}
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={!!busy} onClick={save}>
          {busy === 'save' ? 'در حال ذخیره…' : 'ذخیرهٔ تنظیمات Confluence'}
        </button>
        {savedInApp && (
          <button type="button" className="btn btn-sm btn-ghost-danger" disabled={!!busy} onClick={remove}>
            حذف توکن
          </button>
        )}
      </div>
      {result && (
        <p className={`status-line ${result.ok ? 'ok' : 'bad'}`} role={result.ok ? 'status' : 'alert'}>
          {result.ok ? '✓' : '✗'} {result.message}
        </p>
      )}
    </div>
  );
}
