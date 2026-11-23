/** Browser side of /api/agents. Secrets are only ever sent, never received: the server answers with masked values. */

export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'url' | 'select';
  required?: boolean;
  secret?: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
  default?: string;
}

export interface ProviderInfo {
  type: string;
  label: string;
  description: string;
  fields: FieldSpec[];
}

export interface AgentTemplate {
  id: string;
  label: string;
  description: string;
  providerType: string;
  name: string;
  settings: Record<string, string>;
}

export interface Agent {
  id: string;
  name: string;
  providerType: string;
  settings: Record<string, string>;
  enabled: boolean;
  builtIn: boolean;
  isDefault: boolean;
  secrets: Record<string, { set: boolean; masked: string | null; fromEnv: boolean }>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentList {
  agents: Agent[];
  defaultAgentId: string | null;
  providers: ProviderInfo[];
  templates: AgentTemplate[];
}

export interface AgentInput {
  name?: string;
  providerType?: string;
  settings?: Record<string, string>;
  /** string = set, null = remove, missing = keep */
  secrets?: Record<string, string | null>;
  enabled?: boolean;
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
  models?: string[];
}

export class AgentApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AgentApiError';
  }
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
  } catch {
    throw new AgentApiError(0, 'سرور محلی در دسترس نیست. آیا `npm run dev` هنوز در حال اجراست؟');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new AgentApiError(res.status, data?.error ?? `درخواست ناموفق بود (HTTP ${res.status}).`);
  return data;
}

const enc = encodeURIComponent;

export const agentsApi = {
  list: () => request<AgentList>('/api/agents'),
  importLegacy: (legacy: { claudeCodeModel: string; anthropicModel: string; ollamaBaseUrl: string; ollamaModel: string }) =>
    request<AgentList>('/api/agents/import-legacy', 'POST', legacy),
  create: (input: AgentInput) => request<AgentList & { agent: Agent }>('/api/agents', 'POST', input),
  update: (id: string, input: AgentInput) => request<AgentList & { agent: Agent }>(`/api/agents/${enc(id)}`, 'PUT', input),
  remove: (id: string) => request<AgentList>(`/api/agents/${enc(id)}`, 'DELETE'),
  setDefault: (id: string) => request<AgentList>(`/api/agents/${enc(id)}/default`, 'POST'),
  test: (input: AgentInput & { id?: string }) => request<ConnectionResult>('/api/agents/test', 'POST', input),
};
