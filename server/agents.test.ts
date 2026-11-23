// @vitest-environment node
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentService } from './agents/agentService.ts';
import { createRegistry } from './agents/registry.ts';
import type { ProviderDefinition } from './agents/types.ts';
import { ProviderError, type ProviderRequest } from './providers.ts';
import { maskSecret, SecretStore } from './secretStore.ts';
import { redact } from './redact.ts';

const KEY = 'sk-test-0123456789abcdef';

/** A provider that records what it receives, for checking routing and secret handling. */
function fakeProvider(type: string, behaviour: Partial<ProviderDefinition> = {}): ProviderDefinition {
  return {
    type,
    label: type,
    description: '',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'url', required: true, default: 'http://localhost:1' },
      { key: 'model', label: 'مدل', type: 'text', required: true, default: 'm1' },
      { key: 'apiKey', label: 'کلید API', type: 'text', secret: true },
    ],
    generate: vi.fn(async (_req, settings, secrets) => JSON.stringify({ type, settings, secrets })),
    testConnection: vi.fn(async (_s, secrets) => (secrets.apiKey === KEY ? { ok: true, message: 'ok' } : { ok: false, message: 'کلید API پذیرفته نشد.' })),
    ...behaviour,
  };
}

const request = (): ProviderRequest => ({ model: '', system: 'S', user: 'U', schema: {}, timeoutMs: 1000, signal: new AbortController().signal });

let dir: string;
let registry: Map<string, ProviderDefinition>;
const service = () => new AgentService(dir, registry, new SecretStore(dir));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agents-'));
  registry = createRegistry();
  registry.set('fake-a', fakeProvider('fake-a'));
  registry.set('fake-b', fakeProvider('fake-b'));
});

describe('AgentService', () => {
  it('starts with the built-in agents of the old providers and Claude Code as default', () => {
    const { agents, defaultAgentId } = service().list();
    expect(agents.map((a) => a.id)).toEqual(['claude-code', 'anthropic', 'ollama']);
    expect(agents.every((a) => a.builtIn && a.enabled)).toBe(true);
    expect(defaultAgentId).toBe('claude-code');
  });

  it('adds, edits, disables, enables and removes agents, and keeps them after a restart', () => {
    const s = service();
    const a = s.create({ name: 'Agent A', providerType: 'fake-a', settings: { baseUrl: 'http://localhost:9/', model: 'x' } });
    expect(a).toMatchObject({ name: 'Agent A', providerType: 'fake-a', enabled: true, settings: { baseUrl: 'http://localhost:9', model: 'x' } });

    s.update(a.id, { name: 'Agent A2', settings: { model: 'y' } });
    s.update(a.id, { enabled: false });
    let saved = service().get(a.id); // a fresh instance reads agents.json
    expect(saved).toMatchObject({ name: 'Agent A2', enabled: false, settings: { model: 'y', baseUrl: 'http://localhost:9' } });

    service().update(a.id, { enabled: true });
    saved = service().get(a.id);
    expect(saved.enabled).toBe(true);

    service().remove(a.id);
    expect(() => service().get(a.id)).toThrow(/پیدا نشد/);
    expect(statSync(join(dir, 'agents.json')).mode & 0o077).toBe(0);
  });

  it('rejects invalid configuration', () => {
    const s = service();
    expect(() => s.create({ name: '', providerType: 'fake-a' })).toThrow(/نام/);
    expect(() => s.create({ name: 'X', providerType: 'nope' })).toThrow(/پشتیبانی نمی‌شود/);
    expect(() => s.create({ name: 'X', providerType: 'fake-a', settings: { baseUrl: 'ftp://x' } })).toThrow(/http/);
    expect(() => s.create({ name: 'X', providerType: 'fake-a', settings: { model: ' ' } })).toThrow(/مدل/);
    s.create({ name: 'X', providerType: 'fake-a' });
    expect(() => s.create({ name: 'X', providerType: 'fake-b' })).toThrow(/وجود دارد/);
    expect(() => s.update('claude-code', { providerType: 'anthropic' })).toThrow(/قابل تغییر نیست/);
  });

  it('stores secrets encrypted, returns them only masked, and deletes them with the agent', () => {
    const s = service();
    const a = s.create({ name: 'A', providerType: 'fake-a', secrets: { apiKey: KEY } });
    const listed = JSON.stringify(s.list());
    expect(listed).not.toContain(KEY);
    expect(a.secrets.apiKey).toEqual({ set: true, masked: maskSecret(KEY), fromEnv: false });
    expect(maskSecret(KEY)).toBe('••••cdef');
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).not.toContain(KEY);
    expect(readFileSync(join(dir, 'agents.json'), 'utf8')).not.toContain(KEY);
    expect(statSync(join(dir, 'secrets.json')).mode & 0o077).toBe(0);

    // missing = keep, null = remove
    s.update(a.id, { name: 'A', secrets: {} });
    expect(service().list().agents.find((x) => x.id === a.id)?.secrets.apiKey.set).toBe(true);
    s.update(a.id, { secrets: { apiKey: null } });
    expect(service().list().agents.find((x) => x.id === a.id)?.secrets.apiKey.set).toBe(false);

    s.update(a.id, { secrets: { apiKey: KEY } });
    s.remove(a.id);
    expect(new SecretStore(dir).has(`agent:${a.id}:apiKey`)).toBe(false);
  });

  it('cannot read the secrets with another key', () => {
    new SecretStore(dir).set('x', KEY);
    expect(() => new SecretStore(dir, Buffer.alloc(32, 7).toString('base64')).get('x')).toThrow();
  });

  it('keeps the default on an enabled agent', () => {
    const s = service();
    const a = s.create({ name: 'A', providerType: 'fake-a' });
    s.setDefault(a.id);
    expect(s.list().defaultAgentId).toBe(a.id);
    s.update(a.id, { enabled: false });
    expect(s.list().defaultAgentId).toBe('claude-code');
    expect(() => s.setDefault(a.id)).toThrow(/غیرفعال/);
    s.remove('claude-code');
    expect(s.list().defaultAgentId).toBe('anthropic');
  });

  it('routes generation to the selected agent’s provider with its own settings and secrets (provider switching)', async () => {
    const s = service();
    const a = s.create({ name: 'A', providerType: 'fake-a', settings: { model: 'ma' }, secrets: { apiKey: KEY } });
    const b = s.create({ name: 'B', providerType: 'fake-b', settings: { model: 'mb' } });
    expect(JSON.parse(await s.generate(a.id, request()))).toMatchObject({ type: 'fake-a', settings: { model: 'ma' }, secrets: { apiKey: KEY } });
    expect(JSON.parse(await s.generate(b.id, request()))).toMatchObject({ type: 'fake-b', settings: { model: 'mb' }, secrets: {} });
  });

  it('refuses disabled or deleted agents and never leaks a key in an error', async () => {
    registry.set('leaky', fakeProvider('leaky', { generate: async () => Promise.reject(new ProviderError(401, `rejected key ${KEY}`)) }));
    const s = service();
    const a = s.create({ name: 'A', providerType: 'leaky', secrets: { apiKey: KEY } });
    await expect(s.generate(a.id, request())).rejects.toThrow('rejected key [REDACTED]');
    s.update(a.id, { enabled: false });
    await expect(s.generate(a.id, request())).rejects.toMatchObject({ status: 409 });
    await expect(s.generate('agent_missing', request())).rejects.toMatchObject({ status: 404 });
  });

  it('tests the connection with saved or unsaved values: valid key, invalid key, unreachable service', async () => {
    registry.set('down', fakeProvider('down', { testConnection: async () => Promise.reject(new Error('ECONNREFUSED')) }));
    const s = service();
    const a = s.create({ name: 'A', providerType: 'fake-a', secrets: { apiKey: KEY } });
    expect(await s.test({ id: a.id })).toMatchObject({ ok: true });
    expect(await s.test({ id: a.id, secrets: { apiKey: 'wrong-key-123' } })).toEqual({ ok: false, message: 'کلید API پذیرفته نشد.' });
    expect(await s.test({ providerType: 'fake-a', settings: {}, secrets: { apiKey: KEY } })).toMatchObject({ ok: true });
    expect(await s.test({ providerType: 'down' })).toEqual({ ok: false, message: 'ECONNREFUSED' });
  });

  it('copies the old browser settings into the built-in agents once, and never over the user’s edits', () => {
    const s = service();
    s.importLegacy({ claudeCodeModel: 'sonnet', anthropicModel: 'claude-sonnet-5-5', ollamaBaseUrl: 'http://10.0.0.5:11434', ollamaModel: 'qwen3' });
    const byId = (id: string) => service().get(id).settings;
    expect(byId('claude-code')).toEqual({ model: 'sonnet' });
    expect(byId('anthropic')).toEqual({ model: 'claude-sonnet-5-5' });
    expect(byId('ollama')).toEqual({ baseUrl: 'http://10.0.0.5:11434', model: 'qwen3' });
    service().importLegacy({ claudeCodeModel: 'opus' });
    expect(byId('claude-code')).toEqual({ model: 'sonnet' });
  });
});

describe('redact', () => {
  it('removes known secrets, auth headers and token-looking values', () => {
    expect(redact(`key ${KEY} failed`, [KEY])).toBe('key [REDACTED] failed');
    expect(redact('Authorization: Bearer abcdefghijklmnop')).not.toContain('abcdefghijklmnop');
    expect(redact('https://x/y?api_key=abc123&x=1')).toBe('https://x/y?api_key=[REDACTED]&x=1');
    expect(redact('got sk-ant-api03-abcdefghij')).toBe('got [REDACTED]');
  });
});
