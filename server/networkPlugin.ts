import type { Connect, Plugin } from 'vite';
import type { ConfluenceCredentialStore } from './confluence/credentials.ts';
import { isSameOrigin, readBody, send } from './http.ts';
import type { NetworkRouter } from './network/router.ts';
import { ProviderError } from './providers.ts';

export interface NetworkPluginOptions {
  router: () => NetworkRouter;
  confluence: () => ConfluenceCredentialStore;
  /** Default Confluence URL when none is configured. */
  confluenceFallback?: string;
}

/** A well-known agent API host used to check the VPN path; only a TCP tunnel is opened, no request is sent. */
const AGENT_PROBE = 'https://api.anthropic.com';

/**
 * Network routing endpoints:
 *   GET  /api/network/status    -> RoutingStatus (setting, VPN / direct interfaces, availability)
 *   PUT  /api/network/settings  -> { agentVpn: boolean } then the new status
 *   POST /api/network/verify    -> opens a tunnel to Confluence (direct path) and to an agent API host (VPN path)
 */
export function networkPlugin(options: NetworkPluginOptions): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split('?')[0];
    if (!url?.startsWith('/api/network/')) return next();
    if (!isSameOrigin(req)) return send(res, 403, { error: 'درخواست از سایت‌های دیگر مجاز نیست.' });
    const router = options.router();
    const run = async (fn: () => Promise<unknown>) => {
      try {
        send(res, 200, await fn());
      } catch (err) {
        send(res, err instanceof ProviderError ? err.status : 500, { error: err instanceof ProviderError ? err.message : 'خطای داخلی سرور محلی.' });
      }
    };
    if (url === '/api/network/status' && req.method === 'GET') return void run(() => router.status());
    if (url === '/api/network/settings' && req.method === 'PUT') {
      return void run(async () => {
        let body: { agentVpn?: unknown } = {};
        try {
          body = JSON.parse((await readBody(req, 4096)) || '{}') as { agentVpn?: unknown };
        } catch {
          throw new ProviderError(400, 'بدنهٔ درخواست نامعتبر است.');
        }
        router.setSettings(body);
        return router.status();
      });
    }
    if (url === '/api/network/verify' && req.method === 'POST') {
      return void run(async () => {
        const confluenceUrl = new URL(options.confluence().resolve()?.baseUrl ?? options.confluenceFallback ?? 'https://confluence.snappfood.ir');
        const [confluence, agent] = await Promise.all([router.probe('confluence', confluenceUrl), router.probe('agent', new URL(AGENT_PROBE))]);
        return { confluence: { host: confluenceUrl.host, ...confluence }, agent: { host: new URL(AGENT_PROBE).host, ...agent } };
      });
    }
    send(res, 404, { error: 'Not found' });
  };
  return {
    name: 'local-network-endpoint',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
