import { generateBasic } from './basicGenerator';
import { tableFromRows, templateProblems } from './model';
import { normalizeResponse } from './parseResponse';
import { buildPrompt } from './prompt';
import { normalizeSeedCells } from './seedData';
import type { GeneratedTable, Settings, Standard, Template } from './types';

/** What the local server endpoint receives. Only the current generation's data is sent. */
export interface AiRequest {
  provider: Exclude<Settings['provider'], 'basic'>;
  /** With provider 'agent': the agent that runs the request (its model and keys live on the server). */
  agentId?: string;
  model?: string;
  baseUrl?: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  timeoutMs: number;
}

/** A replaceable transport: the app uses the local server endpoint, tests inject a fake. */
export type AiTransport = (req: AiRequest, signal: AbortSignal) => Promise<string>;

export class GenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GenerationError';
  }
}

export const httpTransport: AiTransport = async (req, signal) => {
  let res: Response;
  try {
    res = await fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new GenerationError('سرور محلی در دسترس نیست. آیا `npm run dev` هنوز در حال اجراست؟');
  }
  const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || typeof body?.text !== 'string') {
    throw new GenerationError(body?.error ?? `درخواست AI ناموفق بود (HTTP ${res.status}).`);
  }
  return body.text;
};

/**
 * Who answers the request. Agents are resolved on the server; the older providers send exactly the fields they
 * always sent, so their requests (and so their output) are unchanged.
 */
export function aiTarget(settings: Settings): Pick<AiRequest, 'provider' | 'agentId' | 'model' | 'baseUrl'> {
  if (settings.provider === 'basic') throw new GenerationError('برای این کار یک Agent (AI) لازم است. در تنظیمات یک Agent انتخاب کنید.');
  if (settings.provider === 'agent') {
    if (!settings.agentId) throw new GenerationError('هیچ Agentی انتخاب نشده است. در تنظیمات یک Agent انتخاب کنید.');
    return { provider: 'agent', agentId: settings.agentId };
  }
  return {
    provider: settings.provider,
    model: { 'claude-code': settings.claudeCodeModel, anthropic: settings.anthropicModel, ollama: settings.ollamaModel }[settings.provider],
    baseUrl: settings.provider === 'ollama' ? settings.ollamaBaseUrl : undefined,
  };
}

export interface GenerateArgs {
  standard: Standard;
  template: Template;
  input: string;
  settings: Settings;
  signal: AbortSignal;
  transport?: AiTransport;
  /**
   * Asked every `settings.timeoutSeconds` (default 120) while the AI is still working; resolve true to keep waiting,
   * false to stop. The request keeps running while the question is open. Without it, that time is a hard timeout.
   */
  onSlow?: (elapsedSeconds: number) => Promise<boolean>;
}

/** Longest a generation may run when the user keeps confirming (the local server allows the same). */
export const MAX_CONFIRMED_WAIT_MS = 30 * 60_000;

/**
 * Generates a new table. Throws GenerationError (or AbortError) on any failure and never touches
 * existing state, so the caller decides when to replace the current table.
 */
export async function generateTable({ standard, template, input, settings, signal, transport = httpTransport, onSlow }: GenerateArgs): Promise<GeneratedTable> {
  if (!input.trim()) throw new GenerationError('ابتدا نیازمندی‌ها یا یادداشت‌ها را وارد کنید؛ Seed Data از روی آن‌ها ساخته می‌شود.');
  const problems = templateProblems(template);
  if (problems.length) throw new GenerationError(problems.join(' '));

  if (settings.provider === 'basic') {
    const { rows, notes } = generateBasic(input, template.columns);
    if (rows.length === 0) throw new GenerationError('از ورودی هیچ ردیفی ساخته نشد.');
    return tableFromRows(template.columns, normalizeSeedCells(template.columns, rows), 'basic', notes);
  }

  const target = aiTarget(settings);
  const prompt = buildPrompt(standard, template.columns, input);
  const intervalMs = (settings.timeoutSeconds > 0 ? settings.timeoutSeconds : 120) * 1000;
  const timeoutMs = onSlow ? MAX_CONFIRMED_WAIT_MS : intervalMs;
  const timeout = AbortSignal.timeout(timeoutMs);
  const stopped = new AbortController();
  const combined = AbortSignal.any([signal, timeout, stopped.signal]);

  // Ask again after every interval the user agreed to wait; a "no" stops the request.
  const started = Date.now();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    timer = setTimeout(async () => {
      const keepWaiting = await onSlow!(Math.round((Date.now() - started) / 1000));
      if (finished || combined.aborted) return;
      if (keepWaiting) arm();
      else stopped.abort();
    }, intervalMs);
  };
  if (onSlow) arm();

  let text: string;
  try {
    text = await transport(
      {
        ...target,
        system: prompt.system,
        user: prompt.user,
        schema: prompt.schema,
        timeoutMs,
      },
      combined,
    );
  } catch (err) {
    if (signal.aborted) throw err;
    if (stopped.signal.aborted) throw new GenerationError('ساخت به انتخاب شما متوقف شد. ورودی و جدول فعلی تغییری نکرد.');
    if (timeout.aborted && onSlow) throw new GenerationError(`AI بعد از ${Math.round(MAX_CONFIRMED_WAIT_MS / 60_000)} دقیقه هم پاسخ نداد. دوباره تلاش کنید.`);
    if (timeout.aborted) throw new GenerationError(`AI در ${settings.timeoutSeconds} ثانیه پاسخ نداد. دوباره تلاش کنید یا در تنظیمات زمان انتظار را بیشتر کنید.`);
    if (err instanceof GenerationError) throw err;
    throw new GenerationError(err instanceof Error ? err.message : 'درخواست AI ناموفق بود.');
  } finally {
    finished = true;
    clearTimeout(timer);
  }

  try {
    const { rows, notes } = normalizeResponse(text, template.columns);
    return tableFromRows(template.columns, normalizeSeedCells(template.columns, rows), 'ai', notes);
  } catch (err) {
    throw new GenerationError(err instanceof Error ? err.message : 'پاسخ AI قابل استفاده نبود.');
  }
}
