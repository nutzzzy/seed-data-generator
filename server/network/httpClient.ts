import { ProxyAgent, type Dispatcher } from 'undici';
import type { NetworkRouter } from './router.ts';
import { NetworkRouteError } from './router.ts';
import type { RoutePurpose } from './types.ts';

/** The only way agent providers and Confluence code reach the network. */
export interface HttpClient {
  readonly purpose: RoutePurpose;
  fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  /** Proxy variables for a child process (CLI agents); empty when requests use the OS route. */
  childEnv(): Promise<Record<string, string>>;
}

/**
 * fetch with a per-request network path. With routing off (or no router) it is exactly globalThis.fetch, so
 * existing behavior and test stubs are unchanged. With routing on, the request goes through a ProxyAgent that tunnels
 * (HTTP CONNECT) via the local relay pinned to the right interface; TLS and certificate checks stay in this process.
 * Nothing is set process-wide: no HTTP(S)_PROXY, no global dispatcher.
 */
export class RoutedHttpClient implements HttpClient {
  private readonly agents = new Map<string, ProxyAgent>();

  constructor(
    readonly purpose: RoutePurpose,
    private readonly router: NetworkRouter | null,
  ) {}

  private dispatcher(port: number, token: string, pinId: string): Dispatcher {
    const key = `${port}|${pinId}`;
    let agent = this.agents.get(key);
    if (!agent) {
      // A restarted relay has a new port / token: drop agents of the old one.
      for (const [k, a] of this.agents) {
        if (!k.startsWith(`${port}|`)) {
          void a.close().catch(() => {});
          this.agents.delete(k);
        }
      }
      agent = new ProxyAgent({ uri: `http://127.0.0.1:${port}`, token: `Basic ${Buffer.from(`${pinId}:${token}`).toString('base64')}` });
      this.agents.set(key, agent);
    }
    return agent;
  }

  async fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
    if (!this.router) return globalThis.fetch(input, init);
    const binding = await this.router.binding(this.purpose, new URL(String(input)));
    if (binding.kind === 'default') return globalThis.fetch(input, init);
    const dispatcher = this.dispatcher(binding.relay.port, binding.relay.token, binding.iface.pinId);
    try {
      return await globalThis.fetch(input, { ...init, dispatcher } as RequestInit);
    } catch (err) {
      if (init.signal?.aborted) throw err;
      const routeErr = await this.router.explainFailure(this.purpose, binding.iface, err);
      throw routeErr ?? err;
    }
  }

  async childEnv(): Promise<Record<string, string>> {
    if (!this.router || this.purpose !== 'agent') return {};
    return this.router.childEnv();
  }
}

let clients: { agent: HttpClient; confluence: HttpClient } = {
  agent: new RoutedHttpClient('agent', null),
  confluence: new RoutedHttpClient('confluence', null),
};

/** AgentHttpClient: used by every agent provider (API and CLI). */
export const agentHttp = (): HttpClient => clients.agent;
/** ConfluenceHttpClient: used by every Confluence operation; never takes the agent (VPN) path. */
export const confluenceHttp = (): HttpClient => clients.confluence;

/** Called once by the runtime; null restores plain fetch (tests). */
export function useNetworkRouter(router: NetworkRouter | null) {
  clients = { agent: new RoutedHttpClient('agent', router), confluence: new RoutedHttpClient('confluence', router) };
}

/** Replace the clients directly (tests). */
export function setHttpClients(next: Partial<typeof clients>) {
  clients = { ...clients, ...next };
}

export { NetworkRouteError };
