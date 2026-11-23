import { ConfluenceError, getPageByUrl, webUrl, type ConfluenceApi, type ContentJson } from './api.ts';

/** One retrieved page: content plus the metadata needed for references and safe updates. */
export interface RetrievedPage {
  id: string;
  title: string;
  url: string;
  version: number;
  spaceKey?: string;
  parentId: string | null;
  depth: number;
  lastUpdated?: string;
  updatedBy?: string;
  storage: string;
  text: string;
}

export interface RetrievalFailure {
  /** The page (or the page whose children could not be listed). */
  id?: string;
  title?: string;
  url?: string;
  what: 'page' | 'children';
  reason: string;
  status?: number;
}

export interface RetrievalResult {
  root: RetrievedPage;
  pages: RetrievedPage[];
  failures: RetrievalFailure[];
  /** Pages that exist but were not read because a limit was reached. */
  skippedByLimit: number;
}

export interface TraverseOptions {
  maxPages?: number;
  maxDepth?: number;
  pageSize?: number;
  signal?: AbortSignal;
  onProgress?: (p: { read: number; current: string }) => void;
}

/** Confluence storage format (XHTML) to plain text that keeps headings, list items and table rows on their own lines. */
export function storageToText(storage: string): string {
  return storage
    .replace(/<ac:plain-text-body><!\[CDATA\[([\s\S]*?)\]\]><\/ac:plain-text-body>/g, (_m, code: string) => `\n${code}\n`)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<\/(h[1-6]|p|div|li|tr|table|ul|ol|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toPage(baseUrl: string, p: ContentJson, parentId: string | null, depth: number): RetrievedPage {
  const storage = p.body?.storage?.value ?? '';
  return {
    id: p.id,
    title: p.title,
    url: webUrl(baseUrl, p) ?? `${baseUrl.replace(/\/+$/, '')}/pages/viewpage.action?pageId=${p.id}`,
    version: p.version.number,
    spaceKey: p.space?.key,
    parentId,
    depth,
    lastUpdated: p.version.when,
    updatedBy: p.version.by?.displayName,
    storage,
    text: storageToText(storage),
  };
}

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Confluence Hierarchy Traversal: reads the page at the link and all of its descendants (breadth-first), following
 * pagination of every child list. Pages or child lists that cannot be read are reported, never silently skipped.
 * Note: Confluence does not list child pages the token is not allowed to see, so those cannot be reported.
 */
export async function traverse(api: ConfluenceApi, baseUrl: string, pageUrl: string, options: TraverseOptions = {}): Promise<RetrievalResult> {
  const { maxPages = 300, maxDepth = 8, pageSize = 25, signal, onProgress } = options;
  const rootJson = await getPageByUrl(api, baseUrl, pageUrl, signal);
  if (rootJson.type !== 'page') throw new ConfluenceError(400, 'این لینک به یک صفحهٔ Confluence اشاره نمی‌کند.');
  const root = toPage(baseUrl, rootJson, rootJson.ancestors?.at(-1)?.id ?? null, 0);
  const pages: RetrievedPage[] = [root];
  const failures: RetrievalFailure[] = [];
  let skippedByLimit = 0;
  onProgress?.({ read: 1, current: root.title });

  const queue: RetrievedPage[] = [root];
  while (queue.length) {
    const parent = queue.shift()!;
    if (parent.depth >= maxDepth) {
      // Count children beyond the depth limit so the user knows they were not read.
      try {
        const peek = await api<{ size: number; _links?: { next?: string } }>(`/rest/api/content/${parent.id}/child/page?limit=1`, { signal });
        if (peek.size > 0) skippedByLimit += peek.size;
      } catch {
        /* reported below only when children are actually read */
      }
      continue;
    }
    for (let start = 0; ; start += pageSize) {
      signal?.throwIfAborted();
      let batch: { results: ContentJson[]; size: number; _links?: { next?: string } };
      try {
        batch = await api(`/rest/api/content/${parent.id}/child/page?expand=body.storage,version,space&limit=${pageSize}&start=${start}`, { signal });
      } catch (err) {
        if (signal?.aborted) throw err;
        failures.push({ id: parent.id, title: parent.title, url: parent.url, what: 'children', reason: reasonOf(err), status: err instanceof ConfluenceError ? err.status : undefined });
        break;
      }
      for (const child of batch.results) {
        if (pages.length >= maxPages) {
          skippedByLimit++;
          continue;
        }
        if (!child.body?.storage) {
          // The list did not include the body: load the page on its own.
          try {
            child.body = (await api<ContentJson>(`/rest/api/content/${child.id}?expand=body.storage,version,space`, { signal })).body;
          } catch (err) {
            if (signal?.aborted) throw err;
            failures.push({ id: child.id, title: child.title, what: 'page', reason: reasonOf(err), status: err instanceof ConfluenceError ? err.status : undefined });
            continue;
          }
        }
        const page = toPage(baseUrl, child, parent.id, parent.depth + 1);
        pages.push(page);
        queue.push(page);
        onProgress?.({ read: pages.length, current: page.title });
      }
      if (!batch._links?.next || batch.results.length < pageSize) break;
    }
  }
  return { root, pages, failures, skippedByLimit };
}
