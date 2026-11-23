import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isLocalDestination, NetworkRouteError, type NetworkRouter } from '../network/router.ts';
import { ProviderError, type ProviderRequest } from '../providers.ts';
import { redact } from '../redact.ts';
import { ensureDir, SecretStore, writePrivateFile } from '../secretStore.ts';
import { AGENT_TEMPLATES, checkHttpUrl } from './registry.ts';
import type { AgentConfig, AgentSettings, AgentView, ConnectionResult, ProviderDefinition } from './types.ts';

interface StoreFile {
  version: 1;
  defaultAgentId: string | null;
  /** Set once the browser's old provider settings were copied into the built-in agents. */
  legacyImported: boolean;
  agents: AgentConfig[];
}

/** What the Add / Edit form sends. Secrets: a string sets the value, null removes it, missing keeps it. */
export interface AgentInput {
  name?: unknown;
  providerType?: unknown;
  settings?: unknown;
  secrets?: unknown;
  enabled?: unknown;
}

/** The browser's settings from before agents existed (src/lib/types.ts Settings). */
export interface LegacySettings {
  claudeCodeModel?: unknown;
  anthropicModel?: unknown;
  ollamaBaseUrl?: unknown;
  ollamaModel?: unknown;
}

export class AgentError extends ProviderError {}

const EPOCH = '2026-01-01T00:00:00.000Z';
const now = () => new Date().toISOString();

/** The providers that existed before agents, as agents with the same ids, so old settings map onto them. */
function builtInAgents(): AgentConfig[] {
  const agent = (id: string, name: string, settings: AgentSettings): AgentConfig => ({
    id,
    name,
    providerType: id,
    settings,
    enabled: true,
    builtIn: true,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  });
  return [
    agent('claude-code', 'Claude Code', { model: '' }),
    agent('anthropic', 'Claude (Anthropic API)', { model: 'claude-opus-5-5' }),
    agent('ollama', 'Ollama (مدل محلی)', { baseUrl: 'http://localhost:11434', model: 'llama3.1' }),
  ];
}

/**
 * Agent Configuration Service: add, edit, enable / disable, remove and test agents, pick the default one,
 * and run a generation request with an agent. Configs live in agents.json, secrets in the encrypted SecretStore.
 */
export class AgentService {
  private state: StoreFile | null = null;

  constructor(
    private readonly dir: string,
    private readonly registry: Map<string, ProviderDefinition>,
    private readonly secrets: SecretStore,
    /** Provider types whose secret falls back to a value from .env.local (e.g. ANTHROPIC_API_KEY). */
    private readonly envFallbacks: Set<string> = new Set(),
    /** Explains failures caused by a VPN drop when agent VPN routing is on. */
    private readonly network?: Pick<NetworkRouter, 'explainAgentFailure'>,
  ) {}

  private get file() {
    return join(this.dir, 'agents.json');
  }

  private load(): StoreFile {
    if (this.state) return this.state;
    if (existsSync(this.file)) {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.agents)) throw new AgentError(500, `${this.file} قابل خواندن نیست.`);
      return (this.state = parsed);
    }
    return (this.state = { version: 1, defaultAgentId: 'claude-code', legacyImported: false, agents: builtInAgents() });
  }

  private save(next: StoreFile) {
    ensureDir(this.dir);
    writePrivateFile(this.file, JSON.stringify(next, null, 2));
    this.state = next;
  }

  private provider(type: string): ProviderDefinition {
    const p = this.registry.get(type);
    if (!p) throw new AgentError(400, `نوع سرویس «${type}» پشتیبانی نمی‌شود.`);
    return p;
  }

  private secretName = (agentId: string, key: string) => `agent:${agentId}:${key}`;

  private secretsOf(agent: Pick<AgentConfig, 'id' | 'providerType'>): AgentSettings {
    const out: AgentSettings = {};
    for (const f of this.provider(agent.providerType).fields) {
      if (!f.secret) continue;
      const v = this.secrets.get(this.secretName(agent.id, f.key));
      if (v) out[f.key] = v;
    }
    return out;
  }

  private view(agent: AgentConfig, defaultId: string | null): AgentView {
    const secrets: AgentView['secrets'] = {};
    for (const f of this.registry.get(agent.providerType)?.fields ?? []) {
      if (!f.secret) continue;
      const name = this.secretName(agent.id, f.key);
      secrets[f.key] = { set: this.secrets.has(name), masked: this.secrets.masked(name), fromEnv: this.envFallbacks.has(agent.providerType) };
    }
    return { ...agent, settings: { ...agent.settings }, isDefault: agent.id === defaultId, secrets };
  }

  providers() {
    return [...this.registry.values()].map(({ type, label, description, fields }) => ({ type, label, description, fields }));
  }

  /** Templates whose provider is available in this registry. */
  templates() {
    return AGENT_TEMPLATES.filter((t) => this.registry.has(t.providerType));
  }

  list(): { agents: AgentView[]; defaultAgentId: string | null } {
    const s = this.load();
    return { agents: s.agents.map((a) => this.view(a, s.defaultAgentId)), defaultAgentId: s.defaultAgentId };
  }

  get(id: string): AgentConfig {
    const agent = this.load().agents.find((a) => a.id === id);
    if (!agent) throw new AgentError(404, 'این Agent پیدا نشد؛ ممکن است حذف شده باشد. در تنظیمات Agent دیگری انتخاب کنید.');
    return agent;
  }

  /** Validates the non-secret settings against the provider's fields and fills in defaults. */
  private cleanSettings(provider: ProviderDefinition, raw: unknown, previous: AgentSettings = {}): AgentSettings {
    const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out: AgentSettings = {};
    for (const f of provider.fields) {
      if (f.secret) continue;
      const given = input[f.key];
      let value = typeof given === 'string' ? given.trim() : (previous[f.key] ?? f.default ?? '');
      if (value.length > 500) throw new AgentError(400, `مقدار «${f.label}» خیلی طولانی است.`);
      if (f.required && !value) throw new AgentError(400, `«${f.label}» را وارد کنید.`);
      if (f.type === 'url' && value) value = checkHttpUrl(value, f.label).replace(/\/+$/, '');
      if (f.type === 'select' && value && !f.options?.some((o) => o.value === value)) throw new AgentError(400, `مقدار «${f.label}» معتبر نیست.`);
      out[f.key] = value;
    }
    return out;
  }

  private applySecrets(agent: AgentConfig, raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const input = raw as Record<string, unknown>;
    for (const f of this.provider(agent.providerType).fields) {
      if (!f.secret || !(f.key in input)) continue;
      const v = input[f.key];
      const name = this.secretName(agent.id, f.key);
      if (v === null || v === '') this.secrets.delete(name);
      else if (typeof v === 'string') {
        if (v.length > 4096 || /\s/.test(v.trim())) throw new AgentError(400, `مقدار «${f.label}» معتبر نیست.`);
        this.secrets.set(name, v.trim());
      }
    }
  }

  private cleanName(raw: unknown): string {
    const name = typeof raw === 'string' ? raw.trim() : '';
    if (!name) throw new AgentError(400, 'برای Agent نام انتخاب کنید.');
    if (name.length > 80) throw new AgentError(400, 'نام Agent حداکثر ۸۰ حرف است.');
    return name;
  }

  create(input: AgentInput): AgentView {
    const s = this.load();
    const provider = this.provider(typeof input.providerType === 'string' ? input.providerType : '');
    const name = this.cleanName(input.name);
    if (s.agents.some((a) => a.name === name)) throw new AgentError(409, `Agentی با نام «${name}» وجود دارد.`);
    const agent: AgentConfig = {
      id: `agent_${randomBytes(6).toString('hex')}`,
      name,
      providerType: provider.type,
      settings: this.cleanSettings(provider, input.settings),
      enabled: input.enabled !== false,
      builtIn: false,
      createdAt: now(),
      updatedAt: now(),
    };
    this.applySecrets(agent, input.secrets);
    const defaultAgentId = s.defaultAgentId ?? (agent.enabled ? agent.id : null);
    this.save({ ...s, defaultAgentId, agents: [...s.agents, agent] });
    return this.view(agent, defaultAgentId);
  }

  update(id: string, input: AgentInput): AgentView {
    const s = this.load();
    const current = this.get(id);
    if (input.providerType !== undefined && input.providerType !== current.providerType) {
      throw new AgentError(400, 'نوع سرویس یک Agent قابل تغییر نیست؛ یک Agent جدید بسازید.');
    }
    const name = input.name === undefined ? current.name : this.cleanName(input.name);
    if (s.agents.some((a) => a.id !== id && a.name === name)) throw new AgentError(409, `Agentی با نام «${name}» وجود دارد.`);
    const provider = this.provider(current.providerType);
    const next: AgentConfig = {
      ...current,
      name,
      settings: input.settings === undefined ? current.settings : this.cleanSettings(provider, input.settings, current.settings),
      enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
      updatedAt: now(),
    };
    this.applySecrets(next, input.secrets);
    const agents = s.agents.map((a) => (a.id === id ? next : a));
    this.save({ ...s, agents, defaultAgentId: this.repairDefault(s.defaultAgentId, agents) });
    return this.view(next, this.load().defaultAgentId);
  }

  remove(id: string) {
    const s = this.load();
    this.get(id);
    const agents = s.agents.filter((a) => a.id !== id);
    this.secrets.deletePrefix(`agent:${id}:`);
    this.save({ ...s, agents, defaultAgentId: this.repairDefault(s.defaultAgentId, agents) });
  }

  setDefault(id: string) {
    const agent = this.get(id);
    if (!agent.enabled) throw new AgentError(409, 'Agent غیرفعال نمی‌تواند پیش‌فرض باشد. اول آن را فعال کنید.');
    this.save({ ...this.load(), defaultAgentId: id });
  }

  /** Keeps the default pointing at an enabled agent after a delete or disable. */
  private repairDefault(current: string | null, agents: AgentConfig[]): string | null {
    if (current && agents.some((a) => a.id === current && a.enabled)) return current;
    return agents.find((a) => a.enabled)?.id ?? null;
  }

  /** Copies the models / URL from the browser's old settings into the built-in agents, once. */
  importLegacy(legacy: LegacySettings) {
    const s = this.load();
    if (s.legacyImported) return this.list();
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);
    const patch: Record<string, AgentSettings> = {
      'claude-code': { model: str(legacy.claudeCodeModel) ?? '' },
      anthropic: { model: str(legacy.anthropicModel) || 'claude-opus-5-5' },
      ollama: { baseUrl: str(legacy.ollamaBaseUrl) || 'http://localhost:11434', model: str(legacy.ollamaModel) || 'llama3.1' },
    };
    const agents = s.agents.map((a) => {
      if (!a.builtIn || !patch[a.id] || a.updatedAt !== EPOCH) return a;
      try {
        return { ...a, settings: this.cleanSettings(this.provider(a.providerType), patch[a.id], a.settings) };
      } catch {
        return a; // keep the built-in default when an old value is invalid
      }
    });
    this.save({ ...s, agents, legacyImported: true });
    return this.list();
  }

  /** Tests a saved agent, or the unsaved form values (missing secrets come from the saved agent). */
  async test(input: AgentInput & { id?: unknown }): Promise<ConnectionResult> {
    const saved = typeof input.id === 'string' && input.id ? this.get(input.id) : undefined;
    const type = saved?.providerType ?? (typeof input.providerType === 'string' ? input.providerType : '');
    const provider = this.provider(type);
    const settings = input.settings === undefined && saved ? saved.settings : this.cleanSettings(provider, input.settings, saved?.settings);
    const secrets = saved ? this.secretsOf(saved) : {};
    if (input.secrets && typeof input.secrets === 'object') {
      for (const [k, v] of Object.entries(input.secrets as Record<string, unknown>)) {
        if (v === null || v === '') delete secrets[k];
        else if (typeof v === 'string') secrets[k] = v.trim();
      }
    }
    const result = await provider.testConnection(settings, secrets).catch((err: unknown) => ({ ok: false, message: err instanceof Error ? err.message : String(err) }));
    return { ...result, message: redact(result.message, Object.values(secrets)) };
  }

  private isLocalAgent(agent: AgentConfig): boolean {
    try {
      return Boolean(agent.settings.baseUrl) && isLocalDestination(new URL(agent.settings.baseUrl));
    } catch {
      return false;
    }
  }

  /** Agent Execution Adapter: runs one request with the agent's provider. Errors never contain its secrets. */
  async generate(agentId: string, req: ProviderRequest): Promise<string> {
    const agent = this.get(agentId);
    if (!agent.enabled) throw new AgentError(409, `Agent «${agent.name}» غیرفعال است. آن را در تنظیمات فعال کنید یا Agent دیگری انتخاب کنید.`);
    const secrets = this.secretsOf(agent);
    try {
      return await this.provider(agent.providerType).generate(req, agent.settings, secrets);
    } catch (err) {
      if (this.network && !req.signal.aborted && !(err instanceof NetworkRouteError) && !this.isLocalAgent(agent)) {
        const routeErr = await this.network.explainAgentFailure();
        if (routeErr) throw routeErr;
      }
      if (err instanceof Error) err.message = redact(err.message, Object.values(secrets));
      throw err;
    }
  }
}
