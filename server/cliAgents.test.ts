// @vitest-environment node
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRegistry } from './agents/registry.ts';
import { generateWithCodex, generateWithCursor, generateWithGemini } from './cliAgents.ts';
import { ProviderError } from './providers.ts';

const KEY = 'sk-test-0123456789abcdef';
const dir = mkdtempSync(join(tmpdir(), 'fake-cli-'));

/** Writes a stand-in CLI. `body` runs after stdin is read, with `args`, `stdin` and `opt(name)` available. */
function fakeCli(body: string): string {
  const file = join(dir, `cli-${Math.random().toString(36).slice(2)}`);
  writeFileSync(
    file,
    `#!/usr/bin/env node
const fs = require('fs');
let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const opt = (n) => args[args.indexOf(n) + 1];
  const echo = { args, stdin, cwd: process.cwd(), env: { CODEX_API_KEY: process.env.CODEX_API_KEY, CURSOR_API_KEY: process.env.CURSOR_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY } };
  ${body}
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

const request = (bin: string, extra: { apiKey?: string; model?: string; user?: string } = {}) => ({
  bin,
  model: extra.model ?? '',
  apiKey: extra.apiKey,
  system: 'SYSTEM RULES',
  user: extra.user ?? 'USER INPUT',
  schema: { type: 'object', properties: { rows: { type: 'array' } } },
  timeoutMs: 10_000,
  signal: new AbortController().signal,
});

describe('Codex CLI', () => {
  const bin = fakeCli(`
    fs.writeFileSync(opt('--output-last-message'), JSON.stringify({ ...echo, schema: JSON.parse(fs.readFileSync(opt('--output-schema'), 'utf8')) }));
  `);

  it('runs `codex exec -` read-only and ephemeral in an empty folder, with the schema file and the key only in the environment', async () => {
    const out = JSON.parse(await generateWithCodex(request(bin, { apiKey: KEY, model: 'gpt-5-codex' })));
    expect(out.args.slice(0, 1)).toEqual(['exec']);
    expect(out.args).toEqual(expect.arrayContaining(['--skip-git-repo-check', '--ephemeral', '--sandbox', 'read-only', '-']));
    expect(out.args[out.args.indexOf('--model') + 1]).toBe('gpt-5-codex');
    expect(out.schema).toEqual({ type: 'object', properties: { rows: { type: 'array' } } });
    expect(out.stdin).toContain('SYSTEM RULES');
    expect(out.stdin).toContain('USER INPUT');
    expect(out.env.CODEX_API_KEY).toBe(KEY);
    expect(out.args.join(' ')).not.toContain(KEY);
    expect(existsSync(out.cwd)).toBe(false); // the temporary folder is removed afterwards
  });

  it('explains a missing login and never shows the key', async () => {
    const failing = fakeCli(`process.stderr.write('Error: not logged in. Run codex login. key=${KEY}'); process.exit(1);`);
    const err = (await generateWithCodex(request(failing, { apiKey: KEY })).catch((e: unknown) => e)) as ProviderError;
    expect(err.status).toBe(401);
    expect(err.message).toContain('codex login');
    expect(err.message).not.toContain(KEY);
  });
});

describe('Cursor CLI', () => {
  it('runs in ask (read-only) mode with JSON output and returns the result text', async () => {
    const bin = fakeCli(`process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(echo) }) + '\\n');`);
    const out = JSON.parse(await generateWithCursor(request(bin, { apiKey: KEY })));
    expect(out.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--mode', 'ask', '--trust']));
    expect(out.args[out.args.indexOf('--workspace') + 1]).toBe(out.cwd);
    const prompt = out.args[out.args.length - 1];
    expect(prompt).toContain('SYSTEM RULES');
    expect(prompt).toContain('JSON schema');
    expect(out.env.CURSOR_API_KEY).toBe(KEY);
    expect(out.args.join(' ')).not.toContain(KEY);
  });

  it('passes a very large prompt as a file in the empty workspace instead of an argument', async () => {
    const bin = fakeCli(`
      const prompt = args[args.length - 1];
      const file = fs.readFileSync(opt('--workspace') + '/request.md', 'utf8');
      process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify({ prompt, fileHasInput: file.includes('BIG') }) }));
    `);
    const out = JSON.parse(await generateWithCursor(request(bin, { user: 'BIG '.repeat(40_000) })));
    expect(out.prompt).toContain('request.md');
    expect(out.fileHasInput).toBe(true);
  });

  it('reports a missing login (non-zero exit, message on stderr) and a missing install', async () => {
    const bin = fakeCli(`process.stderr.write("Error: Authentication required. Please run 'agent login' first"); process.exit(1);`);
    await expect(generateWithCursor(request(bin))).rejects.toMatchObject({ status: 401, message: expect.stringContaining('cursor-agent login') });
    await expect(generateWithCursor(request(join(dir, 'missing')))).rejects.toMatchObject({ status: 503 });
  });
});

describe('Gemini CLI', () => {
  it('runs headless in plan (read-only) mode with the prompt on stdin and returns `response`', async () => {
    const bin = fakeCli(`process.stdout.write(JSON.stringify({ response: JSON.stringify(echo), stats: {} }));`);
    const out = JSON.parse(await generateWithGemini(request(bin, { apiKey: KEY, model: 'gemini-2.5-pro' })));
    expect(out.args).toEqual(expect.arrayContaining(['-p', '', '--output-format', 'json', '--approval-mode', 'plan', '--skip-trust']));
    expect(out.args[out.args.indexOf('--model') + 1]).toBe('gemini-2.5-pro');
    expect(out.stdin).toContain('SYSTEM RULES');
    expect(out.stdin).toContain('JSON schema');
    expect(out.env.GEMINI_API_KEY).toBe(KEY);
  });

  it('explains a 403 from Google as a network / region problem', async () => {
    const bin = fakeCli(`process.stdout.write(JSON.stringify({ error: { message: 'Error 403 (Forbidden)!! Your client does not have permission' } })); process.exit(1);`);
    await expect(generateWithGemini(request(bin))).rejects.toMatchObject({ status: 403, message: expect.stringContaining('VPN') });
  });
});

describe('registry', () => {
  it('offers Codex, Cursor and Gemini CLI agents whose connection test finds the executable', async () => {
    const registry = createRegistry();
    for (const type of ['codex-cli', 'cursor-cli', 'gemini-cli']) expect(registry.has(type)).toBe(true);
    const versionCli = fakeCli(`process.stdout.write('9.9.9\\n');`);
    const ok = await registry.get('gemini-cli')!.testConnection({ cliPath: versionCli }, {});
    expect(ok).toMatchObject({ ok: true, message: expect.stringContaining('9.9.9') });
    const missing = await registry.get('codex-cli')!.testConnection({ cliPath: join(dir, 'missing') }, {});
    expect(missing.ok).toBe(false);
  });
});
