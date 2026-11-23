// @vitest-environment node
// Every agent provider goes through the AgentHttpClient and every Confluence call through the ConfluenceHttpClient.
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentService } from '../agents/agentService.ts';
import type { ProviderDefinition } from '../agents/types.ts';
import { generateWithGemini } from '../cliAgents.ts';
import { confluenceApi, ConfluenceError } from '../confluence/api.ts';
import { generateWithOpenAiCompatible } from '../openaiCompatible.ts';
import { generateWithAnthropic, generateWithOllama, ProviderError } from '../providers.ts';
import { SecretStore } from '../secretStore.ts';
import { RoutedHttpClient, setHttpClients, useNetworkRouter, type HttpClient } from './httpClient.ts';
import { NetworkRouteError } from './router.ts';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

function spyClient(purpose: 'agent' | 'confluence', respond: (url: string) => Response | Promise<Response>, env: Record<string, string> = {}) {
  const calls: string[] = [];
  const client: HttpClient = {
    purpose,
    fetch: vi.fn(async (input: string | URL) => {
      calls.push(String(input));
      return respond(String(input));
    }),
    childEnv: vi.fn(async () => env),
  };
  return { client, calls };
}

const routeError = () => new NetworkRouteError('vpn-missing', 'VPN not connected');
const req = () => ({ model: 'm', system: 'S', user: 'U', schema: { type: 'object' }, timeoutMs: 5000, signal: new AbortController().signal });

function sse(text: string): Response {
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(0, 5) } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(5) } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } }],
    ['message_stop', { type: 'message_stop' }],
  ];
  const body = events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

afterEach(() => {
  useNetworkRouter(null);
  vi.unstubAllGlobals();
});

describe('AgentHttpClient is used by every agent provider (provider switching)', () => {
  it('Anthropic (streaming), OpenAI-compatible and Ollama all go through the agent client, never the Confluence client', async () => {
    const agent = spyClient('agent', (url) => (url.includes('anthropic') ? sse('{"rows":[]}') : url.includes('/api/chat') ? json({ message: { content: '{"o":1}' } }) : json({ choices: [{ message: { content: '{"x":1}' }, finish_reason: 'stop' }] })));
    const confluence = spyClient('confluence', () => json({}));
    setHttpClients({ agent: agent.client, confluence: confluence.client });

    expect(await generateWithAnthropic(req(), 'sk-ant-test')).toBe('{"rows":[]}');
    expect(await generateWithOpenAiCompatible({ ...req(), baseUrl: 'https://api.example.com/v1', responseFormat: 'json_schema' })).toBe('{"x":1}');
    expect(await generateWithOllama({ ...req(), baseUrl: 'http://localhost:11434' })).toBe('{"o":1}');

    expect(agent.calls.map((u) => new URL(u).host)).toEqual(['api.anthropic.com', 'api.example.com', 'localhost:11434']);
    expect(confluence.calls).toEqual([]);
  });

  it('a route error reaches the user unchanged (not "check your internet") and is not retried on another path', async () => {
    const agent = spyClient('agent', () => Promise.reject(routeError()));
    setHttpClients({ agent: agent.client });
    await expect(generateWithAnthropic(req(), 'sk-ant-test')).rejects.toMatchObject({ name: 'NetworkRouteError', status: 503 });
    await expect(generateWithOpenAiCompatible({ ...req(), baseUrl: 'https://api.example.com/v1', responseFormat: 'none' })).rejects.toBeInstanceOf(NetworkRouteError);
    await expect(generateWithOllama({ ...req(), baseUrl: 'http://ollama.example.com' })).rejects.toBeInstanceOf(NetworkRouteError);
  });

  it('CLI agents get the proxy variables in their own environment only, and are not started without a VPN', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'net-cli-'));
    const bin = join(dir, 'gemini');
    writeFileSync(bin, `#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({response: String(process.env.HTTPS_PROXY)})));\n`);
    chmodSync(bin, 0o755);
    const proxy = 'http://tun0:tok@127.0.0.1:4000';
    setHttpClients({ agent: spyClient('agent', () => json({}), { HTTPS_PROXY: proxy }).client });
    expect(await generateWithGemini({ ...req(), bin })).toBe(proxy);
    expect(process.env.HTTPS_PROXY).not.toBe(proxy);

    const failing = spyClient('agent', () => json({}));
    failing.client.childEnv = vi.fn(async () => Promise.reject(routeError()));
    setHttpClients({ agent: failing.client });
    await expect(generateWithGemini({ ...req(), bin })).rejects.toBeInstanceOf(NetworkRouteError);
  });

  it('with no router (routing off) the clients are plain fetch: existing behavior and stubs keep working', async () => {
    const stub = vi.fn(async () => json({ choices: [{ message: { content: '{"y":2}' }, finish_reason: 'stop' }] }));
    vi.stubGlobal('fetch', stub);
    useNetworkRouter(null);
    expect(await generateWithOpenAiCompatible({ ...req(), baseUrl: 'https://api.example.com/v1', responseFormat: 'json_schema' })).toBe('{"y":2}');
    expect(stub).toHaveBeenCalledOnce();
    expect((stub.mock.calls[0] as unknown[])[1]).not.toHaveProperty('dispatcher');
  });

  it('RoutedHttpClient adds a dispatcher only for pinned requests', async () => {
    const stub = vi.fn(async () => json({}));
    vi.stubGlobal('fetch', stub);
    const router = {
      binding: vi.fn(async (_p: string, url: URL) =>
        url.host === 'pinned.example.com'
          ? { kind: 'pinned', iface: { name: 'tun0', pinId: 'tun0' }, relay: { port: 4000, token: 't'.repeat(32) } }
          : { kind: 'default' },
      ),
    };
    const client = new RoutedHttpClient('agent', router as never);
    await client.fetch('https://default.example.com');
    await client.fetch('https://pinned.example.com');
    expect((stub.mock.calls[0] as unknown[])[1]).not.toHaveProperty('dispatcher');
    expect((stub.mock.calls[1] as unknown[])[1]).toHaveProperty('dispatcher');
    expect(router.binding).toHaveBeenCalledWith('agent', expect.any(URL));
  });
});

describe('ConfluenceHttpClient is used by every Confluence call', () => {
  it('uses the Confluence client (direct path) by default', async () => {
    const confluence = spyClient('confluence', () => json({ id: '1' }));
    const agent = spyClient('agent', () => json({}));
    setHttpClients({ agent: agent.client, confluence: confluence.client });
    await confluenceApi({ baseUrl: 'https://conf.example.com', authType: 'bearer', token: 'pat' })('/rest/api/content/1');
    expect(confluence.calls).toEqual(['https://conf.example.com/rest/api/content/1']);
    expect(agent.calls).toEqual([]);
  });

  it('an unavailable direct path becomes a ConfluenceError right away, without retries', async () => {
    const confluence = spyClient('confluence', () => Promise.reject(new NetworkRouteError('direct-missing', 'no direct route')));
    const wait = vi.fn(async () => {});
    const api = confluenceApi({ baseUrl: 'https://conf.example.com', authType: 'bearer', token: 'pat' }, { http: confluence.client, wait });
    const err = await api('/rest/api/content/1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfluenceError);
    expect(err).toMatchObject({ status: 503, message: 'no direct route' });
    expect(confluence.calls).toHaveLength(1);
    expect(wait).not.toHaveBeenCalled();
  });
});

describe('AgentService', () => {
  const failingProvider = (type: string): ProviderDefinition => ({
    type,
    label: type,
    description: '',
    fields: [{ key: 'baseUrl', label: 'URL', type: 'url' }],
    generate: async () => Promise.reject(new ProviderError(502, 'CLI failed: connection reset')),
    testConnection: async () => ({ ok: true, message: '' }),
  });

  function service(network: { explainAgentFailure: () => Promise<NetworkRouteError | null> }, baseUrl: string) {
    const dir = mkdtempSync(join(tmpdir(), 'net-svc-'));
    const s = new AgentService(dir, new Map([['p', failingProvider('p')]]), new SecretStore(dir, Buffer.alloc(32, 1).toString('base64')), new Set(), network);
    const agent = s.create({ name: 'A', providerType: 'p', settings: { baseUrl } });
    return { s, id: agent.id };
  }

  it('reports a VPN drop as the cause when a remote agent fails while routing is on and the VPN is gone', async () => {
    const { s, id } = service({ explainAgentFailure: async () => new NetworkRouteError('vpn-dropped', 'VPN dropped') }, 'https://api.example.com');
    await expect(s.generate(id, req())).rejects.toMatchObject({ code: 'vpn-dropped' });
  });

  it('keeps the original error for local agents and when routing explains nothing', async () => {
    const local = service({ explainAgentFailure: async () => new NetworkRouteError('vpn-dropped', 'VPN dropped') }, 'http://localhost:11434');
    await expect(local.s.generate(local.id, req())).rejects.toThrow('CLI failed');
    const fine = service({ explainAgentFailure: async () => null }, 'https://api.example.com');
    await expect(fine.s.generate(fine.id, req())).rejects.toThrow('CLI failed');
  });
});
