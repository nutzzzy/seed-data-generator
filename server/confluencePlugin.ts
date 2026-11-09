import type { IncomingMessage } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { isSameOrigin, readBody, send } from './http.ts';

import type { ConfluenceCredentialStore } from './confluence/credentials.ts';
import { confluenceApi, ConfluenceError, getPageByUrl, webUrl, type ConfluenceApi, type ContentJson } from './confluence/api.ts';

export { ConfluenceError, resolvePageRef } from './confluence/api.ts';

export interface ConfluenceOptions {
  /** Credentials from the app's Confluence settings, or CONFLUENCE_BASE_URL / CONFLUENCE_TOKEN from .env.local. */
  store: () => ConfluenceCredentialStore;
}

/**
 * Local Confluence endpoints:
 *   GET    /api/confluence/status         -> { baseUrl, tokenSet, source, authType, email?, masked } (never the token)
 *   PUT    /api/confluence/config         -> save base URL, auth type, email and token (token: string = set, missing = keep)
 *   DELETE /api/confluence/config         -> remove the token saved in the app
 *   POST   /api/confluence/config/test    -> test the form values (or the saved ones)
 *   GET    /api/confluence/page?url=…     -> the page (id, title, version, storage)            [snapp usecase]
 *   POST   /api/confluence/publish        -> updates a page (version-checked) and attachments [snapp usecase]
 */
export function confluencePlugin(options: ConfluenceOptions): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = req.url?.split('?')[0];
    if (!url?.startsWith('/api/confluence/')) return next();
    if (!isSameOrigin(req)) return send(res, 403, { error: 'درخواست از سایت‌های دیگر مجاز نیست.' });
    const run = async (handler: () => Promise<unknown>) => {
      try {
        send(res, 200, await handler());
      } catch (err) {
        send(res, err instanceof ConfluenceError ? err.status : 502, { error: err instanceof Error ? err.message : 'خطای Confluence.' });
      }
    };
    const store = options.store();
    if (url === '/api/confluence/status' && req.method === 'GET') return void run(async () => store.status());
    if (url === '/api/confluence/config' && req.method === 'PUT') return void run(async () => store.save(await jsonBody(req)));
    if (url === '/api/confluence/config' && req.method === 'DELETE') return void run(async () => store.remove());
    if (url === '/api/confluence/config/test' && req.method === 'POST') return void run(async () => testConnection(store, await jsonBody(req)));
    if (url === '/api/confluence/page' && req.method === 'GET') {
      const pageUrl = new URL(req.url ?? '', 'http://localhost').searchParams.get('url') ?? '';
      return void run(() => getPage(store, pageUrl));
    }
    if (url === '/api/confluence/publish' && req.method === 'POST') return void run(() => publish(store, req));
    send(res, 404, { error: 'Not found' });
  };
  return {
    name: 'local-confluence-endpoint',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

async function jsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const v = JSON.parse((await readBody(req, 64 * 1024)) || '{}') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ConfluenceError(400, 'بدنهٔ درخواست نامعتبر است.');
}

function client(store: ConfluenceCredentialStore): { api: ConfluenceApi; baseUrl: string } {
  const creds = store.resolve();
  if (!creds) {
    throw new ConfluenceError(
      401,
      'توکن Confluence تنظیم نشده است. در تنظیمات Confluence (یا با CONFLUENCE_TOKEN در .env.local) آن را وارد کنید. تا آن موقع می‌توانید محتوای صفحه را کپی و Paste کنید.',
    );
  }
  return { api: confluenceApi(creds), baseUrl: creds.baseUrl };
}

/** Connection Test: who the credentials belong to (works on Data Center and Cloud). */
async function testConnection(store: ConfluenceCredentialStore, input: Record<string, unknown>) {
  const creds = store.candidate(input);
  try {
    const user = await confluenceApi(creds, { retries: 0, timeoutMs: 15_000 })<{ displayName?: string; username?: string; email?: string }>('/rest/api/user/current');
    if (!user.displayName && !user.username && !user.email) return { ok: false, message: 'Confluence پاسخ داد اما کاربر شناخته نشد؛ توکن را بررسی کنید.' };
    return { ok: true, message: `اتصال برقرار است؛ وارد شده با ${user.displayName ?? user.username ?? user.email}.` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function getPage(store: ConfluenceCredentialStore, pageUrl: string) {
  const { api, baseUrl } = client(store);
  const page = await getPageByUrl(api, baseUrl, pageUrl);
  return {
    id: page.id,
    title: page.title,
    version: page.version.number,
    spaceKey: page.space?.key,
    webUrl: webUrl(baseUrl, page) ?? pageUrl,
    storage: page.body?.storage?.value ?? '',
  };
}

interface PublishBody {
  pageId?: unknown;
  version?: unknown;
  storage?: unknown;
  attachments?: unknown;
}

async function publish(store: ConfluenceCredentialStore, req: IncomingMessage) {
  let body: PublishBody;
  try {
    body = JSON.parse(await readBody(req, 25 * 1024 * 1024)) as PublishBody;
  } catch (err) {
    throw new ConfluenceError(400, err instanceof Error ? err.message : 'بدنهٔ درخواست نامعتبر است.');
  }
  const { pageId, version, storage } = body;
  if (typeof pageId !== 'string' || !/^\d+$/.test(pageId) || typeof version !== 'number' || typeof storage !== 'string' || !storage.trim()) {
    throw new ConfluenceError(400, 'شناسهٔ صفحه، نسخه یا محتوا ارسال نشده است.');
  }
  const attachments = Array.isArray(body.attachments) ? (body.attachments as { fileName?: unknown; base64?: unknown }[]) : [];
  const { api, baseUrl } = client(store);

  const current = await api<ContentJson>(`/rest/api/content/${pageId}?expand=version`);
  if (current.version.number !== version) {
    throw new ConfluenceError(
      409,
      `صفحه بعد از ایمپورت در Confluence تغییر کرده است (نسخهٔ ${version} → ${current.version.number}). برای اینکه تغییرات دیگران از بین نرود، اول دوباره ایمپورت کنید.`,
    );
  }

  for (const a of attachments) {
    if (typeof a.fileName !== 'string' || typeof a.base64 !== 'string' || !/^[\w.-]+\.png$/i.test(a.fileName)) continue;
    const existing = await api<{ results: { id: string }[] }>(`/rest/api/content/${pageId}/child/attachment?filename=${encodeURIComponent(a.fileName)}`);
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(a.base64, 'base64')], { type: 'image/png' }), a.fileName);
    form.append('comment', 'Updated from snapp usecase');
    const path = existing.results[0] ? `/rest/api/content/${pageId}/child/attachment/${existing.results[0].id}/data` : `/rest/api/content/${pageId}/child/attachment`;
    await api(path, { method: 'POST', body: form, headers: { 'X-Atlassian-Token': 'no-check' } });
  }

  const updated = await api<ContentJson>(`/rest/api/content/${pageId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: pageId,
      type: current.type,
      title: current.title,
      body: { storage: { value: storage, representation: 'storage' } },
      version: { number: version + 1, message: 'Updated from snapp usecase' },
    }),
  });
  return {
    version: updated.version.number,
    webUrl: webUrl(baseUrl, updated),
  };
}

