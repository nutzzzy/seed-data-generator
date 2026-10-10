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
  { id: 'basic', label: 'Basic (offline, no AI)', detail: 'Turns each line, bullet or “Column: value” block of the input into a row. It doesn’t interpret the text, so most cells need manual work.' },
  { id: 'claude-code', label: 'Claude Code (this computer’s login)', detail: 'Recommended. Uses the Claude Code CLI you are logged into, so usage counts against that account. No API key needed.' },
  { id: 'anthropic', label: 'Claude (Anthropic API)', detail: 'Needs an Anthropic API key (paid usage).' },
  { id: 'ollama', label: 'Local model (Ollama)', detail: 'Free and fully offline. Quality depends on the model you run.' },
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
        <h2 id="settings-title">Settings</h2>
        <fieldset className="providers">
          <legend>How should tables be generated?</legend>
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
                Model <small>optional, e.g. opus or sonnet; leave empty for Claude Code’s default</small>
              </span>
              <input className="mono" value={draft.claudeCodeModel} placeholder="Claude Code default" onChange={(e) => set('claudeCodeModel', e.target.value.trim())} />
            </label>
            <StatusLine
              checking={checking}
              ok={status?.claudeCode?.installed}
              okText={`Claude Code found${status?.claudeCode?.version ? ` (${status.claudeCode.version})` : ''}.`}
              badText="Claude Code was not found on this computer."
            />
            <button type="button" className="btn btn-sm" onClick={check} disabled={checking}>
              Test connection
            </button>
            <div className="howto">
              <b>Set up once:</b>
              <ol>
                <li>
                  Install Claude Code and run <span className="mono">claude</span> once in a terminal to log in.
                </li>
                <li>
                  If <span className="mono">claude</span> is not on your PATH, set <span className="mono">CLAUDE_CODE_PATH=…</span> in <span className="mono">.env.local</span> and restart{' '}
                  <span className="mono">npm run dev</span>.
                </li>
              </ol>
              <p className="hint">The local dev server runs Claude Code with all tools turned off; only the standard, columns and input of the current generation are sent.</p>
            </div>
          </div>
        )}

        {draft.provider === 'anthropic' && (
          <div className="stack">
            <label className="field">
              <span>Model</span>
              <input className="mono" value={draft.anthropicModel} onChange={(e) => set('anthropicModel', e.target.value)} />
            </label>
            <StatusLine
              checking={checking}
              ok={status?.anthropic?.keyDetected}
              okText="API key found on the local server."
              badText="No API key found."
            />
            <div className="howto">
              <b>Set up once:</b>
              <ol>
                <li>
                  Create a key at <span className="mono">console.anthropic.com</span>.
                </li>
                <li>
                  In the project folder, copy <span className="mono">.env.example</span> to <span className="mono">.env.local</span> and set{' '}
                  <span className="mono">ANTHROPIC_API_KEY=…</span>
                </li>
                <li>
                  Restart <span className="mono">npm run dev</span>.
                </li>
              </ol>
              <p className="hint">The key stays on your computer: it is read by the local dev server and never sent to the browser or saved in the app.</p>
            </div>
          </div>
        )}

        {draft.provider === 'ollama' && (
          <div className="stack">
            <div className="rules-grid">
              <label className="field">
                <span>Ollama URL</span>
                <input className="mono" value={draft.ollamaBaseUrl} onChange={(e) => set('ollamaBaseUrl', e.target.value)} />
              </label>
              <label className="field">
                <span>Model</span>
                <input className="mono" value={draft.ollamaModel} onChange={(e) => set('ollamaModel', e.target.value)} list="ollama-models" />
                <datalist id="ollama-models">
                  {status?.ollama?.models.map((m) => <option key={m} value={m} />)}
                </datalist>
              </label>
            </div>
            <StatusLine
              checking={checking}
              ok={status?.ollama?.reachable}
              okText={`Ollama is running${status?.ollama?.models.length ? ` (${status.ollama.models.length} models installed)` : ''}.`}
              badText="Ollama is not reachable at this URL."
            />
            <button type="button" className="btn btn-sm" onClick={check} disabled={checking}>
              Test connection
            </button>
            <div className="howto">
              <b>Set up once:</b> install Ollama from <span className="mono">ollama.com</span>, then run <span className="mono">ollama pull {draft.ollamaModel || 'llama3.1'}</span>.
            </div>
          </div>
        )}

        {draft.provider !== 'basic' && (
          <label className="field narrow">
            <span>Timeout (seconds)</span>
            <input type="number" min={10} max={600} value={draft.timeoutSeconds} onChange={(e) => set('timeoutSeconds', Math.min(600, Math.max(10, Number(e.target.value) || 120)))} />
          </label>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Save settings
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusLine({ checking, ok, okText, badText }: { checking: boolean; ok?: boolean; okText: string; badText: string }) {
  if (checking) return <p className="status-line">Checking…</p>;
  if (ok === undefined) return null;
  return <p className={`status-line ${ok ? 'ok' : 'bad'}`}>{ok ? `✓ ${okText}` : `✗ ${badText}`}</p>;
}
