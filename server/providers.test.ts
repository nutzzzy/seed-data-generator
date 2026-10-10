// @vitest-environment node
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { generateWithClaudeCode, ProviderError } from './providers.ts';

const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));

/** Writes a stand-in for the `claude` CLI that echoes its arguments and stdin back inside the given result. */
function fakeCli(body: string): string {
  const file = join(dir, `claude-${Math.random().toString(36).slice(2)}`);
  writeFileSync(
    file,
    `#!/usr/bin/env node
let stdin = '';
process.stdin.on('data', (d) => (stdin += d));
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  ${body}
});
`,
  );
  chmodSync(file, 0o755);
  return file;
}

const request = (timeoutMs = 10_000) => ({
  model: '',
  system: 'SYSTEM',
  user: 'USER INPUT',
  schema: { type: 'object' },
  timeoutMs,
  signal: new AbortController().signal,
});

afterEach(() => {
  delete process.env.CLAUDE_CODE_PATH;
});

describe('Claude Code provider', () => {
  it('runs the CLI headless with tools off and returns the structured output', async () => {
    process.env.CLAUDE_CODE_PATH = fakeCli(
      `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, structured_output: { args, stdin } }));`,
    );
    const { args, stdin } = JSON.parse(await generateWithClaudeCode(request()));
    expect(stdin).toBe('USER INPUT');
    expect(args).toEqual(expect.arrayContaining(['-p', '--strict-mcp-config', '--no-session-persistence']));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('SYSTEM');
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1])).toEqual({ type: 'object' });
    expect(args).not.toContain('--model');
  });

  it('reports CLI errors, missing installs, unreadable output and timeouts', async () => {
    process.env.CLAUDE_CODE_PATH = fakeCli(
      `process.stdout.write(JSON.stringify({ subtype: 'success', is_error: true, result: 'Not logged in' })); process.exit(1);`,
    );
    await expect(generateWithClaudeCode(request())).rejects.toThrow(/Not logged in/);

    process.env.CLAUDE_CODE_PATH = join(dir, 'does-not-exist');
    await expect(generateWithClaudeCode(request())).rejects.toThrow(/پیدا نشد/);

    process.env.CLAUDE_CODE_PATH = fakeCli(`process.stderr.write('boom'); process.exit(2);`);
    await expect(generateWithClaudeCode(request())).rejects.toThrow(/کد خروج 2.*boom/);

    process.env.CLAUDE_CODE_PATH = fakeCli(`setTimeout(() => {}, 60_000);`);
    await expect(generateWithClaudeCode(request(300))).rejects.toBeInstanceOf(ProviderError);
  });
});
