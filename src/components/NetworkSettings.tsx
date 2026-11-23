import { useEffect, useState } from 'react';
import { networkApi, type NetworkStatus, type ProbeResult } from '../lib/networkClient';

type Api = typeof networkApi;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const STATE_LABEL: Record<NetworkStatus['state'], string> = {
  available: '✓ روشن و در دسترس',
  unavailable: '✗ روشن اما در دسترس نیست',
  disabled: 'خاموش',
  unsupported: '✗ پشتیبانی نمی‌شود',
};

/**
 * "Use VPN for Agent Requests": agent traffic through the VPN the user already connected in the OS, Confluence
 * directly. The app never connects or disconnects the VPN; the toggle is saved on the local server immediately.
 */
export function NetworkSettings({ api = networkApi }: { api?: Api }) {
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [probe, setProbe] = useState<{ confluence: ProbeResult; agent: ProbeResult } | null>(null);

  useEffect(() => {
    let alive = true;
    api.status().then(
      (s) => alive && setStatus(s),
      () => alive && setLoadFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [api]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (on: boolean) =>
    act(async () => {
      setProbe(null);
      setStatus(await api.setAgentVpn(on));
    });

  const verify = () =>
    act(async () => {
      setStatus(await api.status());
      setProbe(await api.verify());
    });

  const unsupported = status?.state === 'unsupported';
  const line = (label: string, r: ProbeResult) =>
    `${r.ok ? '✓' : '✗'} ${label} (${r.host}): ${r.ok ? (r.via === 'default' ? 'مسیر پیش‌فرض سیستم' : `از طریق ${r.via}`) : (r.message ?? 'ناموفق')}`;

  return (
    <fieldset className="network-settings" aria-label="شبکه">
      <legend>شبکه</legend>
      <label className="check">
        <input type="checkbox" aria-label="استفاده از VPN برای درخواست‌های Agent" checked={status?.agentVpn ?? false} disabled={!status || busy || unsupported} onChange={(e) => toggle(e.target.checked)} />
        استفاده از VPN برای درخواست‌های Agent
      </label>
      <small className="hint">
        اول VPN را مثل همیشه از طریق سیستم‌عامل یا برنامهٔ VPN وصل کنید. با روشن بودن این گزینه، درخواست‌های Agent فقط از VPN و درخواست‌های Confluence مستقیم (بدون VPN) ارسال
        می‌شوند. برنامه VPN را وصل یا قطع نمی‌کند و اگر VPN وصل نباشد، درخواست Agent از مسیر عادی ارسال نمی‌شود.
      </small>
      {status && (
        <p className={`status-line ${status.state === 'available' ? 'ok' : status.state === 'disabled' ? '' : 'bad'}`} role="status">
          {STATE_LABEL[status.state]} — {status.message}
        </p>
      )}
      {loadFailed && <p className="status-line bad">وضعیت شبکه (مسیریابی VPN) خوانده نشد.</p>}
      {status && status.support.supported && !status.support.verified && <p className="hint warn">⚠ {status.support.note}</p>}
      {status?.agentVpn && (
        <div>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={verify}>
            {busy ? 'در حال بررسی…' : 'بررسی مسیرها'}
          </button>
        </div>
      )}
      {probe && (
        <>
          <p className={`status-line ${probe.agent.ok ? 'ok' : 'bad'}`}>{line('Agent', probe.agent)}</p>
          <p className={`status-line ${probe.confluence.ok ? 'ok' : 'bad'}`}>{line('Confluence', probe.confluence)}</p>
        </>
      )}
      {error && (
        <p className="status-line bad" role="alert">
          ✗ {error}
        </p>
      )}
    </fieldset>
  );
}
