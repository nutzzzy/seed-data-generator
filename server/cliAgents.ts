import { execFile, spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { agentHttp } from './network/httpClient.ts';
import { ProviderError, type ProviderRequest } from './providers.ts';
import { redact } from './redact.ts';

/**
 * Headless coding-agent CLIs (Codex, Cursor, Gemini) used like Claude Code: the CLI's own login (or an optional API
 * key passed through an environment variable, never on the command line), read-only mode, and an empty temporary
 * working directory so no project files or instructions reach the request.
 */

export interface CliSpec {
  /** Shown in errors, e.g. "Codex". */
  label: string;
  /** Executable names tried on PATH and in the usual install folders (~/.local/bin). */
  names: string[];
  /** Command the user runs once to log in, for error messages. */
  loginHint: string;
}

/** Finds the executable: an explicit path, else the first name found on PATH or in ~/.local/bin. */
export function resolveBin(spec: CliSpec, explicit?: string): string {
  const path = explicit?.trim();
  if (path) return path;
  const dirs = [...(process.env.PATH ?? '').split(delimiter), join(homedir(), '.local', 'bin')].filter(Boolean);
  for (const name of spec.names) {
    for (const dir of dirs) {
      const file = isAbsolute(name) ? name : join(dir, name);
      try {
        accessSync(file, constants.X_OK);
        return file;
      } catch {
        /* try the next one */
      }
    }
  }
  return spec.names[0];
}

export function cliVersion(bin: string, args = ['--version']): Promise<string | null> {
  return new Promise((resolve) => {
    const child = execFile(bin, args, { timeout: 15_000, cwd: tmpdir() }, (err, stdout) => resolve(err ? null : stdout.trim().split('\n')[0] || null));
    // Some CLIs wait for stdin to close even for --version.
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  spec: CliSpec;
  bin: string;
  args: string[];
  stdin: string;
  cwd: string;
  env?: Record<string, string>;
  req: ProviderRequest;
}

async function run({ spec, bin, args, stdin, cwd, env, req }: RunOptions): Promise<RunResult> {
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]);
  // With VPN routing on, only this child process gets proxy variables pointing at the VPN path (throws if no VPN).
  const netEnv = await agentHttp().childEnv();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, signal, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...netEnv, ...env, NO_COLOR: '1', NO_OPEN_BROWSER: '1' } });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (req.signal.aborted) reject(e);
      else if (e.name === 'AbortError') reject(new ProviderError(504, `زمان پاسخ ${spec.label} تمام شد.`));
      else if (e.code === 'ENOENT') reject(new ProviderError(503, `${spec.label} پیدا نشد. آن را نصب کنید یا مسیر فایل اجرایی را در تنظیمات Agent وارد کنید.`));
      else reject(new ProviderError(502, `اجرای ${spec.label} ناموفق بود: ${e.message}`));
    });
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err }));
    child.stdin.on('error', () => {}); // the CLI may exit before reading everything (e.g. not logged in)
    child.stdin.end(stdin);
  });
}

/** A clear message for a failed run: login problems, blocked regions, or the CLI's own (redacted) error text. */
function failure(spec: CliSpec, result: RunResult, secrets: (string | undefined)[], detail?: string): ProviderError {
  const text = redact((detail || result.stderr || result.stdout).trim(), secrets);
  const short = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300);
  if (/auth|log ?in|unauthori[sz]ed|api key|credential/i.test(text)) {
    return new ProviderError(401, `${spec.label} وارد حساب نشده است. یک بار دستور «${spec.loginHint}» را در ترمینال اجرا کنید یا کلید API را در تنظیمات Agent وارد کنید. (${short})`);
  }
  if (/\b403\b|forbidden|not available in your (country|region)|unsupported.*(country|region)|location is not supported/i.test(text)) {
    return new ProviderError(403, `${spec.label} دسترسی را رد کرد (403). احتمالاً سرویس از این شبکه یا منطقه در دسترس نیست؛ VPN یا شبکه را بررسی کنید.`);
  }
  return new ProviderError(502, `${spec.label} با خطا متوقف شد${result.code ? ` (کد خروج ${result.code})` : ''}${short ? `: ${short}` : '.'}`);
}

/** The prompt for CLIs without a system-prompt or schema option: instructions, the request, then the answer format. */
function combinedPrompt(req: ProviderRequest, withSchema: boolean): string {
  const parts = [`<instructions>\n${req.system}\n</instructions>`, req.user];
  if (withSchema) {
    parts.push(
      `Answer with a single JSON object that follows this JSON schema, and nothing else (no prose, no code fences). Do not use tools or read files.\n${JSON.stringify(req.schema)}`,
    );
  }
  return parts.join('\n\n');
}

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'seed-agent-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function lastJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface CliRequest extends ProviderRequest {
  bin?: string;
  apiKey?: string;
}

// ---- Codex ----------------------------------------------------------------------------------------------------

export const CODEX: CliSpec = { label: 'Codex', names: ['codex'], loginHint: 'codex login' };

/** `codex exec -`: prompt on stdin, schema-checked answer via --output-schema, final message written with -o. */
export function generateWithCodex(req: CliRequest): Promise<string> {
  return withTempDir(async (dir) => {
    const schemaFile = join(dir, 'schema.json');
    const outFile = join(dir, 'answer.json');
    writeFileSync(schemaFile, JSON.stringify(req.schema));
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox', 'read-only',
      '--output-schema', schemaFile,
      '--output-last-message', outFile,
      ...(req.model ? ['--model', req.model] : []),
      '-',
    ];
    const result = await run({
      spec: CODEX,
      bin: resolveBin(CODEX, req.bin),
      args,
      stdin: combinedPrompt(req, false),
      cwd: dir,
      env: req.apiKey ? { CODEX_API_KEY: req.apiKey } : undefined,
      req,
    });
    let answer = '';
    try {
      answer = readFileSync(outFile, 'utf8');
    } catch {
      /* no final message */
    }
    if (result.code !== 0 || !answer.trim()) throw failure(CODEX, result, [req.apiKey]);
    return answer;
  });
}

// ---- Cursor ---------------------------------------------------------------------------------------------------

export const CURSOR: CliSpec = { label: 'Cursor', names: ['cursor-agent', 'agent'], loginHint: 'cursor-agent login' };

/** Prompts larger than this are passed as a file in the empty workspace instead of a command-line argument. */
const MAX_ARG = 100_000;

/** `cursor-agent -p --output-format json --mode ask`: read-only, one JSON result object on success. */
export function generateWithCursor(req: CliRequest): Promise<string> {
  return withTempDir(async (dir) => {
    let prompt = combinedPrompt(req, true);
    if (Buffer.byteLength(prompt) > MAX_ARG) {
      writeFileSync(join(dir, 'request.md'), prompt);
      prompt = 'Read the file request.md in the current workspace and follow its instructions exactly. Answer only with the JSON object it asks for.';
    }
    const args = ['-p', '--output-format', 'json', '--mode', 'ask', '--trust', '--workspace', dir, ...(req.model ? ['--model', req.model] : []), prompt];
    const result = await run({
      spec: CURSOR,
      bin: resolveBin(CURSOR, req.bin),
      args,
      stdin: '',
      cwd: dir,
      env: req.apiKey ? { CURSOR_API_KEY: req.apiKey } : undefined,
      req,
    });
    const json = lastJsonObject(result.stdout) as { is_error?: boolean; subtype?: string; result?: string } | null;
    if (result.code !== 0 || !json || json.is_error || (json.subtype && json.subtype !== 'success')) {
      throw failure(CURSOR, result, [req.apiKey], json?.is_error ? json.result : undefined);
    }
    if (!json.result?.trim()) throw new ProviderError(502, 'Cursor پاسخ خالی برگرداند.');
    return json.result;
  });
}

// ---- Gemini ---------------------------------------------------------------------------------------------------

export const GEMINI: CliSpec = { label: 'Gemini CLI', names: ['gemini'], loginHint: 'gemini' };

/** `gemini -p "" --output-format json --approval-mode plan`: stdin is the prompt; answer in {response, error}. */
export function generateWithGemini(req: CliRequest): Promise<string> {
  return withTempDir(async (dir) => {
    const args = ['-p', '', '--output-format', 'json', '--approval-mode', 'plan', '--skip-trust', ...(req.model ? ['--model', req.model] : [])];
    const result = await run({
      spec: GEMINI,
      bin: resolveBin(GEMINI, req.bin),
      args,
      stdin: combinedPrompt(req, true),
      cwd: dir,
      env: req.apiKey ? { GEMINI_API_KEY: req.apiKey } : undefined,
      req,
    });
    const json = lastJsonObject(result.stdout) as { response?: string; error?: { message?: string } } | null;
    if (json?.error || result.code !== 0 || !json) throw failure(GEMINI, result, [req.apiKey], json?.error?.message);
    if (!json.response?.trim()) throw new ProviderError(502, 'Gemini پاسخ خالی برگرداند.');
    return json.response;
  });
}
