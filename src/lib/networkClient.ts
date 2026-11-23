/** Browser side of /api/network/* ("Use VPN for Agent Requests"). */

export type RoutingState = 'disabled' | 'available' | 'unavailable' | 'unsupported';

export interface NetworkStatus {
  /** The saved setting (independent of whether a VPN is connected). */
  agentVpn: boolean;
  state: RoutingState;
  platform: string;
  support: { supported: boolean; verified: boolean; note?: string };
  vpnInterface: string | null;
  directInterface: string | null;
  fullTunnel: boolean;
  message: string;
}

export interface ProbeResult {
  host: string;
  ok: boolean;
  via: string;
  message?: string;
}

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  } catch {
    throw new Error('سرور محلی در دسترس نیست. آیا `npm run dev` هنوز در حال اجراست؟');
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? `درخواست ناموفق بود (HTTP ${res.status}).`);
  return data;
}

export const networkApi = {
  status: () => request<NetworkStatus>('/api/network/status'),
  setAgentVpn: (agentVpn: boolean) => request<NetworkStatus>('/api/network/settings', 'PUT', { agentVpn }),
  verify: () => request<{ confluence: ProbeResult; agent: ProbeResult }>('/api/network/verify', 'POST'),
};
