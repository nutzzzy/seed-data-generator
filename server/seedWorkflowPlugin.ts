import type { IncomingMessage } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { ConfluenceError } from './confluence/api.ts';
import { isSameOrigin, readBody, send } from './http.ts';
import { ProviderError } from './providers.ts';
import { VersionConflict, type SeedJobService } from './seedWorkflow/jobs.ts';

/**
 * Seed data generation workflow (polled by the browser):
 *   POST   /api/seed/jobs                   -> { id }  start: read the Confluence tree, then check for duplicates
 *   GET    /api/seed/jobs/:id               -> status, progress, pages, failures, duplicates, generation context
 *   POST   /api/seed/jobs/:id/decision      -> { action: 'cancel' | 'new' | 'overwrite', targetPageId? }
 *   GET    /api/seed/jobs/:id/target        -> current content + version of the page chosen for overwrite
 *   POST   /api/seed/jobs/:id/publish       -> { approved: true, mode, … } create or update, only after approval
 *   DELETE /api/seed/jobs/:id               -> cancel
 */
export function seedWorkflowPlugin(jobs: () => SeedJobService): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const path = req.url?.split('?')[0] ?? '';
    if (!path.startsWith('/api/seed/')) return next();
    if (!isSameOrigin(req)) return send(res, 403, { error: 'درخواست از سایت‌های دیگر مجاز نیست.' });
    void (async () => {
      try {
        const service = jobs();
        const method = req.method ?? 'GET';
        if (path === '/api/seed/jobs' && method === 'POST') return send(res, 201, service.start(await body(req, 256 * 1024)));
        const m = /^\/api\/seed\/jobs\/([\w-]+)(?:\/(decision|target|publish))?$/.exec(path);
        if (!m) return send(res, 404, { error: 'Not found' });
        const [, id, action] = m;
        if (!action && method === 'GET') return send(res, 200, service.view(id));
        if (!action && method === 'DELETE') return send(res, 200, service.cancel(id));
        if (action === 'decision' && method === 'POST') return send(res, 200, service.decide(id, await body(req, 16 * 1024)));
        if (action === 'target' && method === 'GET') return send(res, 200, await service.target(id));
        if (action === 'publish' && method === 'POST') return send(res, 200, await service.publish(id, await body(req, 6 * 1024 * 1024)));
        send(res, 404, { error: 'Not found' });
      } catch (err) {
        if (err instanceof VersionConflict) return send(res, 409, { error: err.message, conflict: err.current });
        const status = err instanceof ConfluenceError || err instanceof ProviderError ? err.status : 500;
        send(res, status, { error: status === 500 ? 'خطای داخلی سرور محلی.' : (err as Error).message });
        if (status === 500) console.error('[seed]', err instanceof Error ? err.name : 'error');
      }
    })();
  };
  return {
    name: 'local-seed-workflow-endpoint',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

async function body(req: IncomingMessage, max: number): Promise<Record<string, unknown>> {
  try {
    const v = JSON.parse((await readBody(req, max)) || '{}') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ConfluenceError(400, 'بدنهٔ درخواست نامعتبر است.');
}
