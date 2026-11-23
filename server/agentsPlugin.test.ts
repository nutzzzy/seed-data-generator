// @vitest-environment node
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Connect, Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAgentRuntime, type AgentRuntime } from './agents/runtime.ts';
import { agentsPlugin } from './agentsPlugin.ts';
import { aiPlugin } from './aiPlugin.ts';
import { generateWithClaudeCode } from './providers.ts';

const KEY = 'sk-test-0123456789abcdef';

/** Captures the middleware a plugin registers, so requests can be sent to it directly. */
function middlewareOf(plugin: Plugin): Connect.NextHandleFunction {
  let mw: Connect.NextHandleFunction | undefined;
  const hook = plugin.configureServer as (server: { middlewares: { use: (m: Connect.NextHandleFunction) => void } }) => void;
  hook({ middlewares: { use: (m) => (mw = m) } });
  return mw!;
}

async function call(mw: Connect.NextHandleFunction, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage;
  Object.assign(req, { method, url, headers: { host: 'localhost:5173', ...headers } });
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve) => {
    const res: ServerResponse = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader() {},
      on() {},
      end(text: string) {
        resolve({ status: res.statusCode, body: JSON.parse(text) });
      },
    } as unknown as ServerResponse;
    mw(req, res, () => resolve({ status: -1, body: {} }));
  });
}

/** A stand-in for the `claude` CLI that returns its arguments and stdin. */
function fakeClaude(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  const file = join(dir, 'claude');
  writeFileSync(
    file,
    `#!/usr/bin/env node
let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => process.stdout.write(JSON.stringify({ subtype: 'success', is_error: false, structured_output: { args: process.argv.slice(2), stdin } })));
`,
  );
  chmodSync(file, 0o755);
  return file;
}

let runtime: AgentRuntime;
let agents: Connect.NextHandleFunction;
let ai: Connect.NextHandleFunction;

beforeEach(() => {
  runtime = createAgentRuntime({ dataDir: mkdtempSync(join(tmpdir(), 'agents-http-')) });
  agents = middlewareOf(agentsPlugin(() => runtime));
  ai = middlewareOf(aiPlugin({ runtime: () => runtime }));
});
afterEach(() => {
  delete process.env.CLAUDE_CODE_PATH;
});

describe('/api/agents', () => {
  it('lists agents and providers, and never returns a submitted key', async () => {
    const created = await call(agents, 'POST', '/api/agents', {
      name: 'OpenRouter',
      providerType: 'openai-compatible',
      settings: { baseUrl: 'https://openrouter.ai/api/v1', model: 'some/model' },
      secrets: { apiKey: KEY },
    });
    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain(KEY);
    const list = await call(agents, 'GET', '/api/agents');
    expect(JSON.stringify(list.body)).not.toContain(KEY);
    expect((list.body.providers as { type: string }[]).map((p) => p.type)).toEqual([
      'claude-code',
      'anthropic',
      'ollama',
      'openai-compatible',
      'codex-cli',
      'cursor-cli',
      'gemini-cli',
    ]);
    expect((list.body.templates as { id: string }[]).map((t) => t.id)).toEqual(
      expect.arrayContaining(['claude-code', 'codex', 'cursor', 'gemini-cli', 'gemini-api']),
    );
    const agent = (list.body.agents as { name: string; secrets: { apiKey: { set: boolean } } }[]).find((a) => a.name === 'OpenRouter');
    expect(agent?.secrets.apiKey.set).toBe(true);
  });

  it('edits, sets the default, disables and deletes through the API', async () => {
    const { body } = await call(agents, 'POST', '/api/agents', { name: 'Local', providerType: 'ollama' });
    const id = (body.agent as { id: string }).id;
    expect((await call(agents, 'PUT', `/api/agents/${id}`, { settings: { model: 'qwen3' } })).body.agent).toMatchObject({ settings: { model: 'qwen3' } });
    expect((await call(agents, 'POST', `/api/agents/${id}/default`)).body.defaultAgentId).toBe(id);
    expect((await call(agents, 'PUT', `/api/agents/${id}`, { enabled: false })).body.defaultAgentId).toBe('claude-code');
    expect((await call(agents, 'DELETE', `/api/agents/${id}`)).status).toBe(200);
    expect((await call(agents, 'DELETE', `/api/agents/${id}`)).status).toBe(404);
  });

  it('answers with clear errors for bad input and blocks other websites', async () => {
    expect((await call(agents, 'POST', '/api/agents', { name: 'X', providerType: 'ollama', settings: { baseUrl: 'not a url' } })).status).toBe(400);
    expect((await call(agents, 'POST', '/api/agents', { name: 'X', providerType: 'ollama' }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call(agents, 'GET', '/api/other')).status).toBe(-1); // passed on to the next middleware
  });
});

describe('/api/ai/generate', () => {
  const prompt = { system: 'SYSTEM', user: 'USER INPUT', schema: { type: 'object' }, timeoutMs: 10_000 };

  it('keeps the old Claude Code request exactly as before (backward compatibility)', async () => {
    process.env.CLAUDE_CODE_PATH = fakeClaude();
    const res = await call(ai, 'POST', '/api/ai/generate', { provider: 'claude-code', model: '', baseUrl: undefined, ...prompt });
    expect(res.status).toBe(200);
    const viaEndpoint = JSON.parse(res.body.text as string);
    const direct = JSON.parse(await generateWithClaudeCode({ ...prompt, model: '', signal: new AbortController().signal }));
    expect(viaEndpoint).toEqual(direct);
    expect(viaEndpoint.args).toEqual(expect.arrayContaining(['-p', '--strict-mcp-config', '--no-session-persistence']));
    expect(viaEndpoint.args).not.toContain('--model');
  });

  it('runs a configured agent and refuses a disabled one', async () => {
    process.env.CLAUDE_CODE_PATH = fakeClaude();
    runtime.agents.update('claude-code', { settings: { model: 'sonnet' } });
    const res = await call(ai, 'POST', '/api/ai/generate', { provider: 'agent', agentId: 'claude-code', ...prompt });
    expect(res.status).toBe(200);
    const { args } = JSON.parse(res.body.text as string);
    expect(args[args.indexOf('--model') + 1]).toBe('sonnet');

    runtime.agents.update('claude-code', { enabled: false });
    expect((await call(ai, 'POST', '/api/ai/generate', { provider: 'agent', agentId: 'claude-code', ...prompt })).status).toBe(409);
    expect((await call(ai, 'POST', '/api/ai/generate', { provider: 'agent', ...prompt })).status).toBe(400);
    expect((await call(ai, 'POST', '/api/ai/generate', { provider: 'agent', agentId: 'nope', ...prompt })).status).toBe(404);
  });
});
