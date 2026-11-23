/** Browser side of /api/seed/* (generation workflow) and /api/confluence/* (settings). Tokens are only ever sent. */

export interface ConfluenceStatus {
  baseUrl: string;
  tokenSet: boolean;
  source: 'app' | 'env' | null;
  authType: 'bearer' | 'basic';
  email?: string;
  masked: string | null;
}

export interface ConfluenceConfigInput {
  baseUrl: string;
  authType: 'bearer' | 'basic';
  email?: string;
  /** Empty = keep the saved token. */
  token?: string;
}

export interface PageMeta {
  id: string;
  title: string;
  url: string;
  version: number;
  spaceKey?: string;
  parentId: string | null;
  depth: number;
  lastUpdated?: string;
  updatedBy?: string;
}

export interface Failure {
  id?: string;
  title?: string;
  url?: string;
  what: 'page' | 'children';
  reason: string;
  status?: number;
}

export interface DuplicateMatch {
  pageId: string;
  pageTitle: string;
  pageUrl: string;
  seedDataId?: string;
  similarity: 'exact' | 'high' | 'medium';
  explanation: string;
  matchingFields: string[];
  lastUpdated?: string;
  updatedBy?: string;
}

export type JobStatus = 'retrieving' | 'checking' | 'awaiting-decision' | 'ready' | 'publishing' | 'published' | 'cancelled' | 'failed';

export interface PublishedPage {
  pageId: string;
  title: string;
  url: string;
  version: number;
  labels: string[];
  warning?: string;
}

export interface PublishResult {
  operation: 'create' | 'update';
  pages: PublishedPage[];
  agentName: string;
  publishedAt: string;
}

export interface DomainInfo {
  code: string;
  name: string;
  pageId?: string;
  url?: string;
}

export interface JobView {
  id: string;
  status: JobStatus;
  agentId: string;
  agentName: string;
  url: string;
  request: string;
  instructions: string;
  progress: { read: number; current: string };
  pages: PageMeta[];
  failures: Failure[];
  skippedByLimit: number;
  seedEntries: number;
  /** The guide's reference pages (from the Skill): read, but never compared as existing Seed Data. */
  excludedReferences: { id: string; title: string; url: string }[];
  duplicates: DuplicateMatch[];
  /** Existing Seed Data IDs, for the next free number. */
  existingIds: string[];
  domains: DomainInfo[];
  notes: string[];
  decision?: { action: 'new' | 'overwrite'; targetPageId?: string };
  context?: { text: string; included: string[]; omitted: string[] };
  result?: PublishResult;
  error?: string;
}

export interface TargetPage {
  id: string;
  title: string;
  version: number;
  storage: string;
  url?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  } catch {
    throw new ApiError(0, 'سرور محلی در دسترس نیست. آیا `npm run dev` هنوز در حال اجراست؟');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new ApiError(res.status, data?.error ?? `درخواست ناموفق بود (HTTP ${res.status}).`, data ?? undefined);
  return data;
}

export const confluenceApi = {
  status: () => request<ConfluenceStatus>('/api/confluence/status'),
  save: (input: ConfluenceConfigInput) => request<ConfluenceStatus>('/api/confluence/config', 'PUT', input),
  remove: () => request<ConfluenceStatus>('/api/confluence/config', 'DELETE'),
  test: (input: ConfluenceConfigInput) => request<{ ok: boolean; message: string }>('/api/confluence/config/test', 'POST', input),
};

const enc = encodeURIComponent;

export const seedJobsApi = {
  start: (input: { url: string; agentId: string; request: string; instructions: string }) => request<{ id: string }>('/api/seed/jobs', 'POST', input),
  get: (id: string) => request<JobView>(`/api/seed/jobs/${enc(id)}`),
  decide: (id: string, action: 'cancel' | 'new' | 'overwrite', targetPageId?: string) => request<JobView>(`/api/seed/jobs/${enc(id)}/decision`, 'POST', { action, targetPageId }),
  target: (id: string) => request<TargetPage>(`/api/seed/jobs/${enc(id)}/target`),
  cancel: (id: string) => request<JobView>(`/api/seed/jobs/${enc(id)}`, 'DELETE'),
  publish: (
    id: string,
    body:
      | { approved: true; mode: 'create'; pages: { title: string; storage: string; labels: string[]; parentId: string }[] }
      | { approved: true; mode: 'update'; pageId: string; expectedVersion: number; title: string; storage: string; labels: string[] },
  ) => request<PublishResult>(`/api/seed/jobs/${enc(id)}/publish`, 'POST', body),
};
