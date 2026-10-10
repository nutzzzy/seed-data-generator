import { generateBasic } from './basicGenerator';
import { tableFromRows, templateProblems } from './model';
import { normalizeResponse } from './parseResponse';
import { buildPrompt } from './prompt';
import type { GeneratedTable, Settings, Standard, Template } from './types';

/** What the local server endpoint receives. Only the current generation's data is sent. */
export interface AiRequest {
  provider: Exclude<Settings['provider'], 'basic'>;
  model: string;
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
    throw new GenerationError('Could not reach the local AI endpoint. Is `npm run dev` still running?');
  }
  const body = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || typeof body?.text !== 'string') {
    throw new GenerationError(body?.error ?? `The AI request failed (HTTP ${res.status}).`);
  }
  return body.text;
};

export interface GenerateArgs {
  standard: Standard;
  template: Template;
  input: string;
  settings: Settings;
  signal: AbortSignal;
  transport?: AiTransport;
}

/**
 * Generates a new table. Throws GenerationError (or AbortError) on any failure and never touches
 * existing state, so the caller decides when to replace the current table.
 */
export async function generateTable({ standard, template, input, settings, signal, transport = httpTransport }: GenerateArgs): Promise<GeneratedTable> {
  if (!input.trim()) throw new GenerationError('Add some input text first — the table is generated from it.');
  const problems = templateProblems(template);
  if (problems.length) throw new GenerationError(problems.join(' '));

  if (settings.provider === 'basic') {
    const { rows, notes } = generateBasic(input, template.columns);
    if (rows.length === 0) throw new GenerationError('No rows could be created from the input.');
    return tableFromRows(template.columns, rows, 'basic', notes);
  }

  const prompt = buildPrompt(standard, template.columns, input);
  const timeoutMs = (settings.timeoutSeconds > 0 ? settings.timeoutSeconds : 120) * 1000;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = AbortSignal.any([signal, timeout]);

  let text: string;
  try {
    text = await transport(
      {
        provider: settings.provider,
        model: { 'claude-code': settings.claudeCodeModel, anthropic: settings.anthropicModel, ollama: settings.ollamaModel }[settings.provider],
        baseUrl: settings.provider === 'ollama' ? settings.ollamaBaseUrl : undefined,
        system: prompt.system,
        user: prompt.user,
        schema: prompt.schema,
        timeoutMs,
      },
      combined,
    );
  } catch (err) {
    if (signal.aborted) throw err;
    if (timeout.aborted) throw new GenerationError(`The AI did not answer within ${settings.timeoutSeconds} seconds. Try again or raise the timeout in Settings.`);
    if (err instanceof GenerationError) throw err;
    throw new GenerationError(err instanceof Error ? err.message : 'The AI request failed.');
  }

  try {
    const { rows, notes } = normalizeResponse(text, template.columns);
    return tableFromRows(template.columns, rows, 'ai', notes);
  } catch (err) {
    throw new GenerationError(err instanceof Error ? err.message : 'The AI response could not be used.');
  }
}
