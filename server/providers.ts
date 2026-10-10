import Anthropic from '@anthropic-ai/sdk';
import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

export class ProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderRequest {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
  signal: AbortSignal;
}

// Models that accept server-side refusal fallbacks in the "default" routing mode.
const FALLBACK_MODELS = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

export async function generateWithAnthropic(req: ProviderRequest, apiKey?: string): Promise<string> {
  let client: Anthropic;
  try {
    client = new Anthropic({ ...(apiKey ? { apiKey } : {}), timeout: req.timeoutMs, maxRetries: 1 });
  } catch {
    throw new ProviderError(401, 'کلید Anthropic پیدا نشد. ANTHROPIC_API_KEY را در .env.local وارد کنید و `npm run dev` را دوباره اجرا کنید.');
  }

  const useFallbacks = FALLBACK_MODELS.has(req.model);
  try {
    const message = await client.beta.messages
      .stream(
        {
          model: req.model,
          max_tokens: 32000,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: req.schema } },
          ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
        },
        { signal: req.signal },
      )
      .finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new ProviderError(422, 'Claude این درخواست را رد کرد. ورودی یا استاندارد را بازنویسی کنید و دوباره تلاش کنید.');
    }
    if (message.stop_reason === 'max_tokens') {
      throw new ProviderError(422, 'پاسخ خیلی طولانی بود و ناقص ماند. ورودی را به چند بخش کوچک‌تر تقسیم کنید.');
    }
    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    if (!text.trim()) throw new ProviderError(502, 'Claude پاسخ خالی برگرداند.');
    return text;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new ProviderError(401, 'کلید Anthropic پذیرفته نشد. مقدار ANTHROPIC_API_KEY را در .env.local بررسی کنید.');
    }
    if (err instanceof Anthropic.NotFoundError) throw new ProviderError(400, `مدل «${req.model}» پیدا نشد. نام مدل را در تنظیمات بررسی کنید.`);
    if (err instanceof Anthropic.RateLimitError) throw new ProviderError(429, 'به سقف تعداد درخواست Anthropic رسیدید. کمی صبر کنید و دوباره تلاش کنید.');
    if (err instanceof Anthropic.BadRequestError) throw new ProviderError(400, `Anthropic درخواست را نپذیرفت: ${err.message}`);
    if (err instanceof Anthropic.APIConnectionTimeoutError) throw new ProviderError(504, 'زمان پاسخ Anthropic تمام شد.');
    if (err instanceof Anthropic.APIConnectionError) throw new ProviderError(502, 'اتصال به Anthropic برقرار نشد. اینترنت را بررسی کنید.');
    if (err instanceof Anthropic.APIError) throw new ProviderError(502, `خطای Anthropic ${err.status ?? ''}: ${err.message}`.trim());
    if (err instanceof Anthropic.AnthropicError) {
      throw new ProviderError(401, `${err.message} — ANTHROPIC_API_KEY را در .env.local وارد کنید و \`npm run dev\` را دوباره اجرا کنید.`);
    }
    throw err;
  }
}

interface OllamaRequest extends ProviderRequest {
  baseUrl: string;
}

/** Local models through Ollama's /api/chat with JSON-schema constrained output. */
export async function generateWithOllama(req: OllamaRequest): Promise<string> {
  let res: Response;
  try {
    res = await fetch(new URL('/api/chat', req.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        stream: false,
        format: req.schema,
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]),
    });
  } catch (err) {
    if (req.signal.aborted) throw err;
    if (err instanceof Error && err.name === 'TimeoutError') throw new ProviderError(504, 'زمان پاسخ مدل محلی تمام شد.');
    throw new ProviderError(502, `Ollama در آدرس ${req.baseUrl} در دسترس نیست. آیا اجرا شده است؟`);
  }
  const data = (await res.json().catch(() => null)) as { message?: { content?: string }; error?: string } | null;
  if (!res.ok) throw new ProviderError(502, `خطای Ollama: ${data?.error ?? `HTTP ${res.status}`}`);
  const text = data?.message?.content;
  if (!text?.trim()) throw new ProviderError(502, 'مدل محلی پاسخ خالی برگرداند.');
  return text;
}

/** The Claude Code executable; override with CLAUDE_CODE_PATH when it is not on PATH. */
export const claudeCodeBin = () => process.env.CLAUDE_CODE_PATH || 'claude';

export function claudeCodeVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(claudeCodeBin(), ['--version'], { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

interface ClaudeCodeResult {
  is_error?: boolean;
  subtype?: string;
  result?: string;
  structured_output?: unknown;
}

/**
 * Runs the local Claude Code CLI in headless mode, so generation uses this machine's Claude Code login
 * instead of an API key. Tools and MCP servers are disabled: the CLI only answers with schema-checked JSON.
 */
export async function generateWithClaudeCode(req: ProviderRequest): Promise<string> {
  const args = [
    '-p',
    '--output-format', 'json',
    '--json-schema', JSON.stringify(req.schema),
    '--system-prompt', req.system,
    '--tools', '',
    '--strict-mcp-config',
    '--no-session-persistence',
    ...(req.model ? ['--model', req.model] : []),
  ];
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(req.timeoutMs)]);

  const { code, stdout, stderr } = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    // A neutral working directory keeps project files and instructions out of the request.
    const child = spawn(claudeCodeBin(), args, { cwd: tmpdir(), signal, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    child.on('error', (e: NodeJS.ErrnoException) => {
      if (req.signal.aborted) reject(e);
      else if (e.name === 'AbortError') reject(new ProviderError(504, 'زمان پاسخ Claude Code تمام شد.'));
      else if (e.code === 'ENOENT') reject(new ProviderError(503, 'Claude Code پیدا نشد. آن را نصب کنید یا مسیرش را با CLAUDE_CODE_PATH در .env.local مشخص کنید.'));
      else reject(new ProviderError(502, `اجرای Claude Code ناموفق بود: ${e.message}`));
    });
    child.on('close', (c) => resolve({ code: c, stdout: out, stderr: err }));
    child.stdin.end(req.user);
  });

  let result: ClaudeCodeResult;
  try {
    result = JSON.parse(stdout) as ClaudeCodeResult;
  } catch {
    const detail = (stderr || stdout).trim().slice(0, 300);
    throw new ProviderError(502, `Claude Code با خطا متوقف شد${code ? ` (کد خروج ${code})` : ''}${detail ? `: ${detail}` : '.'}`);
  }
  if (result.is_error || result.subtype !== 'success') {
    const detail = result.result?.trim() || result.subtype || 'unknown error';
    throw new ProviderError(502, `خطای Claude Code: ${detail}. اگر وارد حساب نشده‌اید، یک بار دستور \`claude\` را در ترمینال اجرا کنید و وارد شوید.`);
  }
  if (result.structured_output !== undefined && result.structured_output !== null) return JSON.stringify(result.structured_output);
  if (result.result?.trim()) return result.result;
  throw new ProviderError(502, 'Claude Code پاسخ خالی برگرداند.');
}
