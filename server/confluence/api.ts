import { confluenceHttp, NetworkRouteError, type HttpClient } from '../network/httpClient.ts';
import { redact } from '../redact.ts';

export class ConfluenceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ConfluenceError';
  }
}

export type AuthType = 'bearer' | 'basic';

/** Resolved credentials for one request. Built on the server only; never sent to the browser. */
export interface ConfluenceCredentials {
  /** e.g. https://confluence.snappfood.ir (Data Center) or https://x.atlassian.net/wiki (Cloud). */
  baseUrl: string;
  authType: AuthType;
  /** For basic auth (Cloud: Atlassian account email). */
  email?: string;
  token: string;
}

export interface RequestOptions extends RequestInit {
  signal?: AbortSignal;
}

export type ConfluenceApi = <T>(path: string, init?: RequestOptions) => Promise<T>;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason);
    });
  });

/** Seconds from Retry-After (number or HTTP date), capped so a bad header cannot stall a job. */
function retryDelay(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  const seconds = header ? (/^\d+$/.test(header) ? Number(header) : (Date.parse(header) - Date.now()) / 1000) : NaN;
  const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000 * 2 ** attempt;
  return Math.min(ms, 30_000);
}

export interface ApiOptions {
  /** Retries for 429 / 502 / 503 / 504 and network errors. */
  retries?: number;
  timeoutMs?: number;
  /** ConfluenceHttpClient (direct path); replaced in tests. */
  http?: HttpClient;
  /** Replaced in tests to avoid real waiting. */
  wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/**
 * Confluence REST client: auth header, timeouts, retries with Retry-After on rate limits, and Persian error messages.
 * Tokens never appear in errors.
 */
export function confluenceApi(creds: ConfluenceCredentials, options: ApiOptions = {}): ConfluenceApi {
  const base = creds.baseUrl.replace(/\/+$/, '');
  const auth = creds.authType === 'basic' ? `Basic ${Buffer.from(`${creds.email ?? ''}:${creds.token}`).toString('base64')}` : `Bearer ${creds.token}`;
  const retries = options.retries ?? 3;
  const wait = options.wait ?? sleep;
  const http = options.http ?? confluenceHttp();

  return async <T>(path: string, init: RequestOptions = {}): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        const signals = [AbortSignal.timeout(options.timeoutMs ?? 30_000), ...(init.signal ? [init.signal] : [])];
        res = await http.fetch(base + path, {
          ...init,
          headers: { Authorization: auth, Accept: 'application/json', ...((init.headers as Record<string, string>) ?? {}) },
          signal: AbortSignal.any(signals),
        });
      } catch (err) {
        if (init.signal?.aborted) throw err;
        // The direct path is unavailable: never retry (and never fall back to the VPN / default route).
        if (err instanceof NetworkRouteError) throw new ConfluenceError(err.status, err.message);
        if (attempt < retries) {
          await wait(1000 * 2 ** attempt, init.signal);
          continue;
        }
        throw new ConfluenceError(502, `اتصال به ${base} برقرار نشد. VPN یا شبکهٔ داخلی را بررسی کنید.`);
      }
      if ([429, 502, 503, 504].includes(res.status) && attempt < retries) {
        await wait(retryDelay(res, attempt), init.signal);
        continue;
      }
      if (res.status === 401) throw new ConfluenceError(401, 'Confluence توکن را نپذیرفت. توکن را در تنظیمات Confluence بررسی کنید.');
      if (res.status === 403) throw new ConfluenceError(403, 'با این توکن به این صفحه دسترسی ندارید (صفحهٔ محدود).');
      if (res.status === 404) throw new ConfluenceError(404, 'صفحه در Confluence پیدا نشد (ممکن است حذف شده یا محدود باشد).');
      if (res.status === 409) throw new ConfluenceError(409, 'Confluence تغییر را نپذیرفت؛ صفحه در این فاصله تغییر کرده است.');
      if (res.status === 429) throw new ConfluenceError(429, 'به سقف تعداد درخواست Confluence رسیدید. چند دقیقه بعد دوباره تلاش کنید.');
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        const detail = body?.message ? `: ${redact(body.message, [creds.token]).slice(0, 300)}` : '';
        throw new ConfluenceError(res.status === 400 ? 400 : 502, `خطای Confluence ${res.status}${detail}`);
      }
      return (await res.json()) as T;
    }
  };
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

export interface ContentJson {
  id: string;
  title: string;
  type: string;
  status?: string;
  version: { number: number; when?: string; by?: { displayName?: string } };
  space?: { key: string };
  body?: { storage?: { value: string } };
  ancestors?: { id: string }[];
  _links?: { webui?: string; base?: string };
}

export const webUrl = (baseUrl: string, page: ContentJson) => (page._links?.webui ? baseUrl.replace(/\/+$/, '') + page._links.webui : undefined);

export const PAGE_EXPAND = 'expand=body.storage,version,space,ancestors';

/** Loads a page by link (id or space + title). */
export async function getPageByUrl(api: ConfluenceApi, baseUrl: string, pageUrl: string, signal?: AbortSignal): Promise<ContentJson> {
  const ref = resolvePageRef(baseUrl, pageUrl);
  if ('id' in ref) return api<ContentJson>(`/rest/api/content/${ref.id}?${PAGE_EXPAND}`, { signal });
  const found = await api<{ results: ContentJson[] }>(
    `/rest/api/content?spaceKey=${encodeURIComponent(ref.spaceKey)}&title=${encodeURIComponent(ref.title)}&${PAGE_EXPAND}`,
    { signal },
  );
  if (!found.results[0]) throw new ConfluenceError(404, 'صفحه در Confluence پیدا نشد.');
  return found.results[0];
}
