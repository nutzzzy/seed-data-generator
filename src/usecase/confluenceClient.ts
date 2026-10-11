export interface ConfluencePage {
  id: string;
  title: string;
  version: number;
  spaceKey?: string;
  webUrl: string;
  storage: string;
}

export interface ConfluenceStatus {
  baseUrl: string;
  tokenSet: boolean;
}

export class ConfluenceRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ConfluenceRequestError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ConfluenceRequestError(0, 'سرور محلی در دسترس نیست. آیا `npm run dev` هنوز در حال اجراست؟');
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new ConfluenceRequestError(res.status, body?.error ?? `درخواست Confluence ناموفق بود (HTTP ${res.status}).`);
  return body;
}

export const confluenceStatus = () => request<ConfluenceStatus>('/api/confluence/status');

export const fetchConfluencePage = (url: string) => request<ConfluencePage>(`/api/confluence/page?url=${encodeURIComponent(url)}`);

export interface PublishRequest {
  pageId: string;
  version: number;
  storage: string;
  attachments: { fileName: string; base64: string }[];
}

export const publishConfluencePage = (body: PublishRequest) =>
  request<{ version: number; webUrl?: string }>('/api/confluence/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
