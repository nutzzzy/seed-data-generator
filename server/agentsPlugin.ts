import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import type { AgentRuntime } from './agents/runtime.ts';
import { isSameOrigin, readBody, send } from './http.ts';
import { ProviderError } from './providers.ts';

/**
 * Agent management for the local server:
 *   GET    /api/agents                 -> { agents, defaultAgentId, providers, templates }
 *   POST   /api/agents                 -> create
 *   PUT    /api/agents/:id             -> edit / enable / disable (secrets: string = set, null = remove)
 *   DELETE /api/agents/:id             -> remove (and its secrets)
 *   POST   /api/agents/:id/default     -> make it the default agent
 *   POST   /api/agents/test            -> test a saved agent or unsaved form values
 *   POST   /api/agents/import-legacy   -> copy old browser settings into the built-in agents (once)
 * Secrets are accepted but never returned; responses only say whether one is set, masked.
 */
export function agentsPlugin(runtime: () => AgentRuntime): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = req.url?.split('?')[0] ?? '';
    if (path !== '/api/agents' && !path.startsWith('/api/agents/')) return next();
    if (!isSameOrigin(req)) return send(res, 403, { error: 'درخواست از سایت‌های دیگر مجاز نیست.' });
    void route(runtime(), path, req, res);
  };
  return {
    name: 'local-agents-endpoint',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse((await readBody(req, 256 * 1024)) || '{}') as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ProviderError(400, 'بدنهٔ درخواست نامعتبر است.');
}

export async function route({ agents }: AgentRuntime, path: string, req: IncomingMessage, res: ServerResponse) {
  const method = req.method ?? 'GET';
  try {
    const list = () => ({ ...agents.list(), providers: agents.providers(), templates: agents.templates() });
    if (path === '/api/agents' && method === 'GET') return send(res, 200, list());
    if (path === '/api/agents' && method === 'POST') {
      const agent = agents.create(await body(req));
      return send(res, 201, { agent, ...list() });
    }
    if (path === '/api/agents/test' && method === 'POST') return send(res, 200, await agents.test(await body(req)));
    if (path === '/api/agents/import-legacy' && method === 'POST') {
      agents.importLegacy(await body(req));
      return send(res, 200, list());
    }
    const m = /^\/api\/agents\/([\w-]+)(\/default)?$/.exec(path);
    if (m && !m[2] && method === 'PUT') {
      const agent = agents.update(m[1], await body(req));
      return send(res, 200, { agent, ...list() });
    }
    if (m && !m[2] && method === 'DELETE') {
      agents.remove(m[1]);
      return send(res, 200, list());
    }
    if (m && m[2] && method === 'POST') {
      agents.setDefault(m[1]);
      return send(res, 200, list());
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    // Never echo request bodies: they may contain the secret that was just submitted.
    const status = err instanceof ProviderError ? err.status : 500;
    send(res, status, { error: status === 500 ? 'خطای داخلی سرور محلی.' : (err as Error).message });
    if (status === 500) console.error('[agents]', err instanceof Error ? err.name : 'error');
  }
}
