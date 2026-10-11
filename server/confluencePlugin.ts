import type { IncomingMessage } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { isSameOrigin, readBody, send } from './http.ts';

export interface ConfluenceOptions {
  /** e.g. https://confluence.snappfood.ir — only pages on this host are read or written. */
  baseUrl: string;
  /** Personal Access Token (Confluence → Profile → Personal Access Tokens). Stays on this local server. */
  token?: string;
}

export class ConfluenceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Local endpoints for the snapp usecase section:
 *   GET  /api/confluence/status         -> { baseUrl, tokenSet }
 *   GET  /api/confluence/page?url=…     -> the page (id, title, version, storage)
 *   POST /api/confluence/publish        -> updates a page (version-checked) and its diagram attachments
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
    if (url === '/api/confluence/status' && req.method === 'GET') return void run(async () => ({ baseUrl: options.baseUrl, tokenSet: Boolean(options.token) }));
    if (url === '/api/confluence/page' && req.method === 'GET') {
      const pageUrl = new URL(req.url ?? '', 'http://localhost').searchParams.get('url') ?? '';
      return void run(() => getPage(options, pageUrl));
    }
    if (url === '/api/confluence/publish' && req.method === 'POST') return void run(() => publish(options, req));
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

function client(options: ConfluenceOptions) {
  if (!options.token) {
    throw new ConfluenceError(
      401,
      'توکن Confluence تنظیم نشده است. در Confluence از Profile → Personal Access Tokens یک توکن بسازید، آن را با CONFLUENCE_TOKEN در .env.local قرار دهید و `npm run dev` را دوباره اجرا کنید. تا آن موقع می‌توانید محتوای صفحه را کپی و Paste کنید.',
    );
  }
  const base = options.baseUrl.replace(/\/+$/, '');
  return async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(base + path, {
        ...init,
        headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ConfluenceError(502, `اتصال به ${base} برقرار نشد. VPN یا شبکهٔ داخلی را بررسی کنید.`);
    }
    if (res.status === 401) throw new ConfluenceError(401, 'Confluence توکن را نپذیرفت. CONFLUENCE_TOKEN را در .env.local بررسی کنید.');
    if (res.status === 403) throw new ConfluenceError(403, 'با این توکن به این صفحه دسترسی ندارید.');
    if (res.status === 404) throw new ConfluenceError(404, 'صفحه در Confluence پیدا نشد.');
    if (res.status === 409) throw new ConfluenceError(409, 'Confluence تغییر را نپذیرفت؛ صفحه در این فاصله تغییر کرده است. دوباره ایمپورت کنید.');
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new ConfluenceError(502, `خطای Confluence ${res.status}${body?.message ? `: ${body.message}` : ''}`);
    }
    return (await res.json()) as T;
  };
}

interface ContentJson {
  id: string;
  title: string;
  type: string;
  version: { number: number };
  space?: { key: string };
  body?: { storage?: { value: string } };
  _links?: { webui?: string; base?: string };
}

/** Accepts …/pages/123/Title, …/viewpage.action?pageId=123 and …/display/SPACE/Title links on the configured host. */
export function resolvePageRef(baseUrl: string, pageUrl: string): { id: string } | { spaceKey: string; title: string } {
  let url: URL;
  try {
    url = new URL(pageUrl.trim());
  } catch {
    throw new ConfluenceError(400, 'لینک Confluence معتبر نیست.');
  }
  if (url.host !== new URL(baseUrl).host) throw new ConfluenceError(400, `فقط صفحات ${new URL(baseUrl).host} پشتیبانی می‌شوند.`);
  const id = /\/pages\/(\d+)/.exec(url.pathname)?.[1] ?? url.searchParams.get('pageId');
  if (id && /^\d+$/.test(id)) return { id };
  const display = /\/display\/([^/]+)\/([^/?#]+)/.exec(url.pathname);
  if (display) return { spaceKey: decodeURIComponent(display[1]), title: decodeURIComponent(display[2].replace(/\+/g, ' ')) };
  throw new ConfluenceError(400, 'شناسهٔ صفحه از لینک پیدا نشد. لینک کامل صفحه را (مثل …/pages/154408734/…) وارد کنید.');
}

async function getPage(options: ConfluenceOptions, pageUrl: string) {
  const ref = resolvePageRef(options.baseUrl, pageUrl);
  const api = client(options);
  const expand = 'expand=body.storage,version,space';
  let page: ContentJson | undefined;
  if ('id' in ref) page = await api<ContentJson>(`/rest/api/content/${ref.id}?${expand}`);
  else {
    const found = await api<{ results: ContentJson[] }>(`/rest/api/content?spaceKey=${encodeURIComponent(ref.spaceKey)}&title=${encodeURIComponent(ref.title)}&${expand}`);
    page = found.results[0];
    if (!page) throw new ConfluenceError(404, 'صفحه در Confluence پیدا نشد.');
  }
  return {
    id: page.id,
    title: page.title,
    version: page.version.number,
    spaceKey: page.space?.key,
    webUrl: page._links?.webui ? options.baseUrl.replace(/\/+$/, '') + page._links.webui : pageUrl,
    storage: page.body?.storage?.value ?? '',
  };
}

interface PublishBody {
  pageId?: unknown;
  version?: unknown;
  storage?: unknown;
  attachments?: unknown;
}

async function publish(options: ConfluenceOptions, req: IncomingMessage) {
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
  const api = client(options);

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
    webUrl: updated._links?.webui ? options.baseUrl.replace(/\/+$/, '') + updated._links.webui : undefined,
  };
}

