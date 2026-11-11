import { useEffect, useState } from 'react';
import { agentsApi, type Agent, type AgentInput, type AgentList, type AgentTemplate, type ConnectionResult, type ProviderInfo } from '../lib/agentsClient';
import type { Settings } from '../lib/types';
import { useDialogs } from './Dialogs';
import { NetworkSettings } from './NetworkSettings';
import type { networkApi } from '../lib/networkClient';

type Api = typeof agentsApi;

interface Props {
  settings: Settings;
  onSave: (s: Settings) => void;
  onClose: () => void;
  /** Injected in tests; defaults to the local server endpoint. */
  api?: Api;
  networkApi?: typeof networkApi;
}

const BASIC = 'basic';
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The agent a workspace uses: an agent id, 'basic', or an old provider id (= the built-in agent with that id). */
function initialChoice(s: Settings): string {
  if (s.provider === 'basic') return BASIC;
  if (s.provider === 'agent') return s.agentId ?? '';
  return s.provider;
}

/**
 * Agent management: list, add, edit, enable / disable, remove and test agents, choose the default agent, and pick the
 * agent this section uses. Agents and their keys are stored by the local server, never in the browser.
 */
export function SettingsDialog({ settings, onSave, onClose, api = agentsApi, networkApi }: Props) {
  const { confirm } = useDialogs();
  const [data, setData] = useState<AgentList | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState(() => initialChoice(settings));
  const [timeoutSeconds, setTimeoutSeconds] = useState(settings.timeoutSeconds);
  const [editing, setEditing] = useState<Agent | 'new' | null>(null);
  const [tests, setTests] = useState<Record<string, ConnectionResult | 'pending'>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // Until an agent is chosen, the old settings are copied into the built-in agents (once, on the server).
    const load =
      settings.provider === 'agent'
        ? api.list()
        : api.importLegacy({
            claudeCodeModel: settings.claudeCodeModel,
            anthropicModel: settings.anthropicModel,
            ollamaBaseUrl: settings.ollamaBaseUrl,
            ollamaModel: settings.ollamaModel,
          });
    load.then(
      (d) => alive && setData(d),
      (err) => alive && setLoadError(errText(err)),
    );
    return () => {
      alive = false;
    };
  }, [api, settings]);

  const run = async (action: () => Promise<AgentList>) => {
    setError(null);
    try {
      setData(await action());
    } catch (err) {
      setError(errText(err));
    }
  };

  const testAgent = async (agent: Agent) => {
    setTests((t) => ({ ...t, [agent.id]: 'pending' }));
    try {
      const result = await api.test({ id: agent.id });
      setTests((t) => ({ ...t, [agent.id]: result }));
    } catch (err) {
      setTests((t) => ({ ...t, [agent.id]: { ok: false, message: errText(err) } }));
    }
  };

  const removeAgent = async (agent: Agent) => {
    const ok = await confirm({
      title: 'Agent حذف شود؟',
      message: `«${agent.name}» و کلیدهای ذخیره‌شدهٔ آن برای همیشه حذف می‌شوند.`,
      confirmLabel: 'حذف',
      danger: true,
    });
    if (!ok) return;
    await run(() => api.remove(agent.id));
    if (choice === agent.id) setChoice('');
  };

  const providerOf = (type: string) => data?.providers.find((p) => p.type === type);
  const chosen = data?.agents.find((a) => a.id === choice);

  const save = () => {
    const timeout = { timeoutSeconds };
    if (choice === BASIC) return finish({ ...settings, ...timeout, provider: 'basic', agentId: undefined, agentName: undefined });
    if (!data) {
      // The server could not be reached: keep the current choice, only the timeout changes.
      return finish({ ...settings, ...timeout });
    }
    if (!chosen) return setError('یک Agent انتخاب کنید.');
    if (!chosen.enabled) return setError(`«${chosen.name}» غیرفعال است. آن را فعال کنید یا Agent دیگری انتخاب کنید.`);
    finish({ ...settings, ...timeout, provider: 'agent', agentId: chosen.id, agentName: chosen.name });
  };
  const finish = (next: Settings) => {
    onSave(next);
    onClose();
  };

  if (editing && data) {
    return (
      <Shell onClose={onClose} title={editing === 'new' ? 'افزودن Agent' : `ویرایش «${editing.name}»`}>
        <AgentForm
          agent={editing === 'new' ? undefined : editing}
          providers={data.providers}
          templates={data.templates ?? []}
          api={api}
          onCancel={() => setEditing(null)}
          onSaved={(d, agent) => {
            setData(d);
            setEditing(null);
            if (editing === 'new' && agent.enabled) setChoice(agent.id);
          }}
        />
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} title="تنظیمات: Agentها">
      <p className="hint">
        Agent همان سرویس AI است که Seed Data را طبق راهنمای Seed Data تیم می‌سازد. می‌توانید چند Agent تعریف کنید و برای این بخش یکی را انتخاب کنید. کلیدها فقط روی سرور محلی و
        به‌صورت رمزنگاری‌شده نگه داشته می‌شوند.
      </p>

      {loadError && <p className="status-line bad">✗ فهرست Agentها خوانده نشد: {loadError}</p>}
      {!data && !loadError && <p className="status-line">در حال خواندن Agentها…</p>}

      <fieldset className="providers" aria-label="Agentها">
        <legend>Seed Data با کدام Agent ساخته شود؟</legend>
        {data?.agents.map((a) => {
          const provider = providerOf(a.providerType);
          const test = tests[a.id];
          return (
            <div key={a.id} className={`provider agent-row ${choice === a.id ? 'selected' : ''} ${a.enabled ? '' : 'disabled'}`}>
              <input type="radio" name="agent" aria-label={a.name} checked={choice === a.id} disabled={!a.enabled} onChange={() => setChoice(a.id)} />
              <span className="agent-main">
                <strong>
                  {a.name} {a.isDefault && <span className="badge ok">پیش‌فرض</span>} {!a.enabled && <span className="badge bad">غیرفعال</span>}
                </strong>
                <small dir="auto">
                  {provider?.label ?? a.providerType}
                  {a.settings.model ? ` · ${a.settings.model}` : ''}
                </small>
                {test === 'pending' && <small className="status-line">در حال بررسی اتصال…</small>}
                {test && test !== 'pending' && <small className={`status-line ${test.ok ? 'ok' : 'bad'}`}>{`${test.ok ? '✓' : '✗'} ${test.message}`}</small>}
                <span className="agent-actions">
                  <button type="button" className="btn btn-sm" onClick={() => testAgent(a)} disabled={test === 'pending'}>
                    بررسی اتصال
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setEditing(a)}>
                    ویرایش
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => run(() => api.update(a.id, { enabled: !a.enabled }))}>
                    {a.enabled ? 'غیرفعال کردن' : 'فعال کردن'}
                  </button>
                  {!a.isDefault && a.enabled && (
                    <button type="button" className="btn btn-sm" onClick={() => run(() => api.setDefault(a.id))}>
                      پیش‌فرض شود
                    </button>
                  )}
                  <button type="button" className="btn btn-sm btn-ghost-danger" onClick={() => removeAgent(a)} aria-label={`حذف ${a.name}`}>
                    حذف
                  </button>
                </span>
              </span>
            </div>
          );
        })}
        <label className={`provider ${choice === BASIC ? 'selected' : ''}`}>
          <input type="radio" name="agent" checked={choice === BASIC} onChange={() => setChoice(BASIC)} />
          <span>
            <strong>ساده (آفلاین، بدون AI)</strong>
            <small>هر خط یا بلوک «Column: value» ورودی را به یک ردیف تبدیل می‌کند. متن را تحلیل نمی‌کند.</small>
          </span>
        </label>
      </fieldset>

      {data && (
        <div>
          <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}>
            + افزودن Agent
          </button>
        </div>
      )}

      {choice !== BASIC && (
        <label className="field narrow">
          <span>زمان انتظار (ثانیه)</span>
          <input type="number" min={10} max={600} value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Math.min(600, Math.max(10, Number(e.target.value) || 120)))} />
        </label>
      )}

      <NetworkSettings api={networkApi} />

      {error && (
        <p className="status-line bad" role="alert">
          ✗ {error}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>
          انصراف
        </button>
        <button type="button" className="btn btn-primary" onClick={save}>
          ذخیرهٔ تنظیمات
        </button>
      </div>
    </Shell>
  );
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog wide" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2 id="settings-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

interface FormProps {
  agent?: Agent;
  providers: ProviderInfo[];
  templates: AgentTemplate[];
  api: Api;
  onCancel: () => void;
  onSaved: (data: AgentList, agent: Agent) => void;
}

const defaultsOf = (p: ProviderInfo | undefined) => Object.fromEntries((p?.fields ?? []).filter((f) => !f.secret).map((f) => [f.key, f.default ?? '']));

/** Add / Edit form, built from the provider's field list so new providers need no UI code. */
function AgentForm({ agent, providers, templates, api, onCancel, onSaved }: FormProps) {
  const usable = templates.filter((t) => providers.some((p) => p.type === t.providerType));
  const first = agent ? undefined : usable[0];
  const [templateId, setTemplateId] = useState(first?.id ?? '');
  const [providerType, setProviderType] = useState(agent?.providerType ?? first?.providerType ?? providers[0]?.type ?? '');
  const provider = providers.find((p) => p.type === providerType);
  const [name, setName] = useState(agent?.name ?? first?.name ?? provider?.label ?? '');
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...defaultsOf(provider), ...first?.settings, ...agent?.settings }));
  /** string = new value, null = remove the saved one, missing = keep. */
  const [secrets, setSecrets] = useState<Record<string, string | null>>({});
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [test, setTest] = useState<ConnectionResult | 'pending' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Starts the form from a template: its provider, suggested name and settings. A name the user typed is kept. */
  const applyTemplate = (t: AgentTemplate) => {
    const next = providers.find((p) => p.type === t.providerType);
    const current = usable.find((x) => x.id === templateId);
    if (!name.trim() || name === current?.name || name === provider?.label) setName(t.name || next?.label || '');
    setTemplateId(t.id);
    setProviderType(t.providerType);
    setValues({ ...defaultsOf(next), ...t.settings });
    setSecrets({});
    setTest(null);
  };

  const secretPayload = () => Object.fromEntries(Object.entries(secrets).filter(([, v]) => v === null || (typeof v === 'string' && v.trim())));
  const input = (): AgentInput => ({ name, providerType, settings: values, secrets: secretPayload(), enabled });

  const runTest = async () => {
    setTest('pending');
    try {
      setTest(await api.test({ ...input(), id: agent?.id }));
    } catch (err) {
      setTest({ ok: false, message: errText(err) });
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const { providerType: _type, ...edit } = input();
      const res = agent ? await api.update(agent.id, edit) : await api.create(input());
      onSaved(res, res.agent);
    } catch (err) {
      setError(errText(err));
      setSaving(false);
    }
  };

  const models = test && test !== 'pending' ? (test.models ?? []) : [];

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span>نام Agent</span>
        <input aria-label="نام Agent" value={name} maxLength={80} required onChange={(e) => setName(e.target.value)} />
      </label>
      {!agent && usable.length > 0 && (
        <fieldset className="templates">
          <legend>قالب</legend>
          {usable.map((t) => (
            <label key={t.id} className={`provider template ${templateId === t.id ? 'selected' : ''}`}>
              <input type="radio" name="template" aria-label={t.label} checked={templateId === t.id} onChange={() => applyTemplate(t)} />
              <span>
                <strong>{t.label}</strong>
                <small>{t.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div className="field">
        <span>نوع سرویس</span>
        <strong>{provider?.label ?? providerType}</strong>
        {provider && <small>{provider.description}</small>}
      </div>

      {provider?.fields.map((f) => {
        if (f.secret) {
          const saved = agent?.secrets[f.key];
          const removing = secrets[f.key] === null;
          const placeholder = removing
            ? 'پس از ذخیره حذف می‌شود'
            : saved?.set
              ? `ذخیره شده (${saved.masked}) — برای تغییر، مقدار جدید وارد کنید`
              : saved?.fromEnv
                ? 'خالی = مقدار .env.local'
                : 'تنظیم نشده';
          return (
            <label key={f.key} className="field">
              <span>
                {f.label} {f.help && <small>{f.help}</small>}
              </span>
              <input
                type="password"
                className="mono"
                dir="ltr"
                autoComplete="new-password"
                aria-label={f.label}
                placeholder={placeholder}
                value={typeof secrets[f.key] === 'string' ? (secrets[f.key] as string) : ''}
                onChange={(e) => setSecrets((s) => ({ ...s, [f.key]: e.target.value }))}
              />
              {saved?.set && (
                <span>
                  <button
                    type="button"
                    className="link"
                    onClick={() =>
                      setSecrets((s) => {
                        if (removing) {
                          const { [f.key]: _drop, ...rest } = s;
                          return rest;
                        }
                        return { ...s, [f.key]: null };
                      })
                    }
                  >
                    {removing ? 'لغو حذف' : `حذف ${f.label} ذخیره‌شده`}
                  </button>
                </span>
              )}
            </label>
          );
        }
        if (f.type === 'select') {
          return (
            <label key={f.key} className="field">
              <span>
                {f.label} {f.help && <small>{f.help}</small>}
              </span>
              <select aria-label={f.label} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        return (
          <label key={f.key} className="field">
            <span>
              {f.label} {f.help && <small>{f.help}</small>}
            </span>
            <input
              className="mono"
              dir="ltr"
              aria-label={f.label}
              type={f.type === 'url' ? 'url' : 'text'}
              required={f.required}
              placeholder={f.placeholder}
              value={values[f.key] ?? ''}
              list={f.key === 'model' && models.length ? 'agent-models' : undefined}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </label>
        );
      })}
      {models.length > 0 && (
        <datalist id="agent-models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      )}

      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> فعال
      </label>

      <div>
        <button type="button" className="btn btn-sm" onClick={runTest} disabled={test === 'pending'}>
          بررسی اتصال
        </button>
      </div>
      {test === 'pending' && <p className="status-line">در حال بررسی اتصال…</p>}
      {test && test !== 'pending' && <p className={`status-line ${test.ok ? 'ok' : 'bad'}`}>{`${test.ok ? '✓' : '✗'} ${test.message}`}</p>}
      {error && (
        <p className="status-line bad" role="alert">
          ✗ {error}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          بازگشت
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {agent ? 'ذخیرهٔ Agent' : 'افزودن Agent'}
        </button>
      </div>
    </form>
  );
}
