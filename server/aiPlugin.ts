import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { isSameOrigin, readBody, send } from './http.ts';
import type { AgentRuntime } from './agents/runtime.ts';
import { claudeCodeVersion, ProviderError } from './providers.ts';

interface Options {
  /** From .env / .env.local; falls back to the SDK's own credential lookup (env vars, `ant auth login`). */
  anthropicApiKey?: string;
  /** Agents and provider adapters; created lazily so nothing touches the disk until a request needs it. */
  runtime: () => AgentRuntime;
}

interface GenerateBody {
  provider?: unknown;
  /** With provider "agent": the configured agent to run. */
  agentId?: unknown;
  model?: unknown;
  baseUrl?: unknown;
  system?: unknown;
  user?: unknown;
  schema?: unknown;
  timeoutMs?: unknown;
}

/**
 * Adds a tiny local API to the Vite dev and preview servers:
 *   GET  /api/ai/status    -> which providers look configured (?claudeCode also runs `claude --version`)
 *   POST /api/ai/generate  -> { text } from the selected provider
 * Keeping provider calls here means API keys never reach the browser.
 */
export function aiPlugin(options: Options): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split('?')[0];
    if (!url?.startsWith('/api/ai/')) return next();
    if (!isSameOrigin(req)) return send(res, 403, { error: 'درخواست از سایت‌های دیگر مجاز نیست.' });
    if (url === '/api/ai/status' && req.method === 'GET') return void handleStatus(req, res, options);
    if (url === '/api/ai/generate' && req.method === 'POST') return void handleGenerate(req, res, options);
    send(res, 404, { error: 'Not found' });
  };
  return {
    name: 'local-ai-endpoint',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

async function handleStatus(req: IncomingMessage, res: ServerResponse, options: Options) {
  const params = new URL(req.url ?? '', 'http://localhost').searchParams;
  const ollamaUrl = params.get('ollamaBaseUrl');
  let ollama: { reachable: boolean; models: string[]; error?: string } | undefined;
  if (ollamaUrl) {
    try {
      const r = await fetch(new URL('/api/tags', checkHttpUrl(ollamaUrl)), { signal: AbortSignal.timeout(3000) });
      const data = (await r.json()) as { models?: { name: string }[] };
      ollama = { reachable: r.ok, models: (data.models ?? []).map((m) => m.name) };
    } catch (err) {
      ollama = { reachable: false, models: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
  const version = params.has('claudeCode') ? await claudeCodeVersion() : undefined;
  send(res, 200, {
    claudeCode: version === undefined ? undefined : { installed: version !== null, version },
    anthropic: {
      keyDetected: Boolean(options.anthropicApiKey || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    },
    ollama,
  });
}

async function handleGenerate(req: IncomingMessage, res: ServerResponse, options: Options) {
  let body: GenerateBody;
  try {
    body = JSON.parse(await readBody(req, 2 * 1024 * 1024)) as GenerateBody;
  } catch (err) {
    return send(res, 400, { error: err instanceof Error ? err.message : 'بدنهٔ درخواست نامعتبر است.' });
  }
  const { provider, agentId, model, baseUrl, system, user, schema } = body;
  const isAgent = provider === 'agent';
  if (isAgent && (typeof agentId !== 'string' || !agentId)) return send(res, 400, { error: 'Agent انتخاب نشده است.' });
  if (typeof system !== 'string' || typeof user !== 'string' || (!isAgent && (typeof model !== 'string' || (provider !== 'claude-code' && !model.trim())))) {
    return send(res, 400, { error: 'مدل یا متن درخواست ارسال نشده است.' });
  }
  if (!schema || typeof schema !== 'object') return send(res, 400, { error: 'ساختار خروجی (schema) ارسال نشده است.' });
  const timeoutMs = typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? Math.min(body.timeoutMs, 600_000) : 120_000;

  // Stop the upstream call if the browser cancels or goes away.
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const modelName = typeof model === 'string' ? model.trim() : '';
    const request = { model: modelName, system, user, schema: schema as Record<string, unknown>, timeoutMs, signal: controller.signal };
    const { agents, registry } = options.runtime();
    let text: string;
    if (isAgent) text = await agents.generate(agentId as string, request);
    else {
      // Requests from before agents existed: the same provider adapters, configured from the request itself.
      const legacy = typeof provider === 'string' && ['claude-code', 'anthropic', 'ollama'].includes(provider) ? registry.get(provider) : undefined;
      if (!legacy) return send(res, 400, { error: 'روش تولید ناشناخته است.' });
      if (provider === 'ollama' && typeof baseUrl !== 'string') return send(res, 400, { error: 'آدرس Ollama ارسال نشده است.' });
      const settings: Record<string, string> = provider === 'ollama' ? { model: modelName, baseUrl: checkHttpUrl(baseUrl as string) } : { model: modelName };
      text = await legacy.generate(request, settings, {});
    }
    send(res, 200, { text });
  } catch (err) {
    if (controller.signal.aborted) return;
    const status = err instanceof ProviderError ? err.status : 502;
    send(res, status, { error: err instanceof Error ? err.message : 'سرویس AI با خطا مواجه شد.' });
  }
}

function checkHttpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ProviderError(400, 'آدرس Ollama باید با http:// یا https:// شروع شود.');
  return url.toString();
}
