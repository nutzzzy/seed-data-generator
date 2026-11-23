import { existsSync, readFileSync } from 'node:fs';
import { BlockList, isIP, connect } from 'node:net';
import { join } from 'node:path';
import { ProviderError } from '../errors.ts';
import { ensureDir, writePrivateFile } from '../secretStore.ts';
import { RelayProcess, type RelayEndpoint } from './relay.ts';
import type { NetInterface, NetworkRoutingProvider, NetworkSnapshot, RouteBinding, RoutePurpose, RoutingStatus } from './types.ts';

export type RouteErrorCode = 'unsupported' | 'vpn-missing' | 'direct-missing' | 'helper-missing' | 'vpn-dropped' | 'direct-dropped' | 'pin-failed';

/** A request was refused because its required network path is not available. It is never retried on another path. */
export class NetworkRouteError extends ProviderError {
  constructor(
    readonly code: RouteErrorCode,
    message: string,
  ) {
    super(503, message);
    this.name = 'NetworkRouteError';
  }
}

const MSG: Record<Exclude<RouteErrorCode, 'unsupported'>, string> = {
  'vpn-missing':
    'گزینهٔ «استفاده از VPN برای درخواست‌های Agent» روشن است اما هیچ VPN وصلی پیدا نشد. اول VPN را از طریق سیستم‌عامل یا برنامهٔ VPN وصل کنید، یا این گزینه را در تنظیمات خاموش کنید. درخواست از مسیر عادی ارسال نشد.',
  'direct-missing': 'مسیر مستقیم (بدون VPN) برای Confluence پیدا نشد: هیچ شبکهٔ فیزیکی (Wi-Fi / Ethernet) با مسیر پیش‌فرض وصل نیست.',
  'helper-missing':
    'برنامهٔ کمکی مسیریابی اجرا نشد (Python 3.8 یا جدیدتر لازم است). Python 3 را نصب کنید، یا گزینهٔ VPN برای Agent را خاموش کنید.',
  'vpn-dropped': 'اتصال VPN در حین درخواست قطع شد یا تغییر کرد. درخواست از مسیر عادی تکرار نشد؛ VPN را دوباره وصل کنید و دوباره تلاش کنید.',
  'direct-dropped': 'شبکهٔ مستقیم (بدون VPN) در حین درخواست Confluence قطع شد یا تغییر کرد. اتصال شبکه را بررسی کنید و دوباره تلاش کنید.',
  'pin-failed': 'سیستم‌عامل اجازهٔ ارسال از طریق رابط شبکهٔ انتخاب‌شده را نداد. ممکن است VPN ترافیک خارج از تونل را مسدود کند (kill switch).',
};

const LOCAL = new BlockList();
LOCAL.addSubnet('127.0.0.0', 8, 'ipv4');
LOCAL.addSubnet('10.0.0.0', 8, 'ipv4');
LOCAL.addSubnet('172.16.0.0', 12, 'ipv4');
LOCAL.addSubnet('192.168.0.0', 16, 'ipv4');
LOCAL.addSubnet('169.254.0.0', 16, 'ipv4');
LOCAL.addAddress('::1', 'ipv6');
LOCAL.addSubnet('fc00::', 7, 'ipv6');
LOCAL.addSubnet('fe80::', 10, 'ipv6');

/** Loopback / private-network destinations (local Ollama, LM Studio…) always use the OS route, never a pinned one. */
export function isLocalDestination(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const v = isIP(host);
  return v !== 0 && LOCAL.check(host, v === 6 ? 'ipv6' : 'ipv4');
}

interface SettingsFile {
  version: 1;
  agentVpn: boolean;
}

export interface RouterOptions {
  /** Snapshot cache lifetime; detection runs per request otherwise, so VPN changes are picked up quickly. */
  cacheMs?: number;
  relay?: { ensure(): Promise<RelayEndpoint>; stop(): void };
}

/**
 * Decides the network path of each outbound request and keeps the "Use VPN for Agent Requests" setting.
 *   setting off -> every request uses the OS default route (unchanged behavior)
 *   setting on  -> agent requests are pinned to the VPN interface, Confluence requests to the direct interface;
 *                  if the needed interface is missing the request fails (no silent fallback).
 */
export class NetworkRouter {
  private settings: SettingsFile | null = null;
  private cached: { at: number; snap: Promise<NetworkSnapshot> } | null = null;
  private readonly relay: { ensure(): Promise<RelayEndpoint>; stop(): void };

  constructor(
    private readonly dir: string,
    readonly provider: NetworkRoutingProvider,
    private readonly options: RouterOptions = {},
  ) {
    this.relay = options.relay ?? new RelayProcess(() => provider.relayCommand());
  }

  private get file() {
    return join(this.dir, 'network.json');
  }

  getSettings(): { agentVpn: boolean } {
    if (!this.settings) {
      let agentVpn = false;
      try {
        if (existsSync(this.file)) agentVpn = (JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SettingsFile>).agentVpn === true;
      } catch {
        /* unreadable file = default (off) */
      }
      this.settings = { version: 1, agentVpn };
    }
    return { agentVpn: this.settings.agentVpn };
  }

  setSettings(input: { agentVpn?: unknown }): { agentVpn: boolean } {
    if (typeof input.agentVpn !== 'boolean') throw new ProviderError(400, 'مقدار agentVpn باید true یا false باشد.');
    const support = this.provider.support();
    if (input.agentVpn && !support.supported) throw new NetworkRouteError('unsupported', support.note ?? 'روی این سیستم‌عامل پشتیبانی نمی‌شود.');
    const next: SettingsFile = { version: 1, agentVpn: input.agentVpn };
    ensureDir(this.dir);
    writePrivateFile(this.file, JSON.stringify(next, null, 2));
    this.settings = next;
    if (!next.agentVpn) this.relay.stop();
    return this.getSettings();
  }

  /** Current interfaces (cached for a moment). */
  snapshot(fresh = false): Promise<NetworkSnapshot> {
    const ttl = this.options.cacheMs ?? 1500;
    if (fresh || !this.cached || Date.now() - this.cached.at >= ttl) {
      const snap = this.provider.snapshot();
      this.cached = { at: Date.now(), snap };
      snap.catch(() => (this.cached = null));
    }
    return this.cached.snap;
  }

  /** The path for one request. Throws NetworkRouteError when the required path is unavailable. */
  async binding(purpose: RoutePurpose, url: URL): Promise<RouteBinding> {
    if (!this.getSettings().agentVpn || isLocalDestination(url)) return { kind: 'default' };
    const support = this.provider.support();
    if (!support.supported) throw new NetworkRouteError('unsupported', support.note ?? 'روی این سیستم‌عامل پشتیبانی نمی‌شود.');
    const snap = await this.snapshot();
    const iface = purpose === 'agent' ? snap.vpn : snap.direct;
    if (!iface) throw new NetworkRouteError(purpose === 'agent' ? 'vpn-missing' : 'direct-missing', MSG[purpose === 'agent' ? 'vpn-missing' : 'direct-missing']);
    let relay: RelayEndpoint;
    try {
      relay = await this.relay.ensure();
    } catch {
      throw new NetworkRouteError('helper-missing', MSG['helper-missing']);
    }
    return { kind: 'pinned', iface, relay };
  }

  /**
   * After a pinned request failed: if its interface disappeared or changed (VPN dropped / reconnected on another
   * interface), returns a clear error. The caller must not retry on another path.
   */
  async explainFailure(purpose: RoutePurpose, iface: NetInterface, err: unknown): Promise<NetworkRouteError | null> {
    const snap = await this.snapshot(true).catch(() => null);
    const now = purpose === 'agent' ? snap?.vpn : snap?.direct;
    if (!now || now.pinId !== iface.pinId) return new NetworkRouteError(purpose === 'agent' ? 'vpn-dropped' : 'direct-dropped', MSG[purpose === 'agent' ? 'vpn-dropped' : 'direct-dropped']);
    const text = `${(err as Error)?.message ?? ''} ${((err as Error)?.cause as Error)?.message ?? ''}`;
    if (/Proxy response \(502\)/.test(text)) return new NetworkRouteError('pin-failed', MSG['pin-failed']);
    return null;
  }

  /**
   * After an agent request failed for any reason (e.g. a CLI agent's own connection): if VPN routing is on and the VPN
   * is gone now, the real cause is the VPN drop. Returns null otherwise.
   */
  async explainAgentFailure(): Promise<NetworkRouteError | null> {
    if (!this.getSettings().agentVpn || !this.provider.support().supported) return null;
    const snap = await this.snapshot(true).catch(() => null);
    return snap && !snap.vpn ? new NetworkRouteError('vpn-dropped', MSG['vpn-dropped']) : null;
  }

  /** For CLI agents that make their own connections: proxy variables for that one child process (agents only). */
  async childEnv(): Promise<Record<string, string>> {
    const b = await this.binding('agent', new URL('https://agent.invalid'));
    if (b.kind === 'default') return {};
    const proxy = `http://${encodeURIComponent(b.iface.pinId)}:${b.relay.token}@127.0.0.1:${b.relay.port}`;
    const noProxy = 'localhost,127.0.0.1,::1';
    // NODE_USE_ENV_PROXY makes Node-based CLIs (Node 24+) use the variables for fetch as well.
    return { HTTPS_PROXY: proxy, https_proxy: proxy, HTTP_PROXY: proxy, http_proxy: proxy, NO_PROXY: noProxy, no_proxy: noProxy, NODE_USE_ENV_PROXY: '1' };
  }

  /** Opens (and closes) a tunnel to host:port through the path a request of this purpose would take. */
  async probe(purpose: RoutePurpose, url: URL, timeoutMs = 10_000): Promise<{ ok: boolean; via: string; message?: string }> {
    let b: RouteBinding;
    try {
      b = await this.binding(purpose, url);
    } catch (err) {
      return { ok: false, via: '-', message: (err as Error).message };
    }
    const port = Number(url.port) || (url.protocol === 'http:' ? 80 : 443);
    if (b.kind === 'default') return { ok: true, via: 'default' };
    const { iface, relay } = b;
    return new Promise((resolve) => {
      const sock = connect(relay.port, '127.0.0.1');
      const auth = Buffer.from(`${iface.pinId}:${relay.token}`).toString('base64');
      const done = (ok: boolean, message?: string) => {
        clearTimeout(timer);
        sock.destroy();
        resolve({ ok, via: iface.name, message });
      };
      const timer = setTimeout(() => done(false, 'timeout'), timeoutMs);
      sock.on('connect', () => sock.write(`CONNECT ${url.hostname}:${port} HTTP/1.1\r\nHost: ${url.hostname}:${port}\r\nProxy-Authorization: Basic ${auth}\r\n\r\n`));
      sock.once('data', (d: Buffer) => {
        const head = d.toString('latin1');
        const code = /X-Seed-Relay-Error: ([\w-]+)/.exec(head)?.[1];
        done(/^HTTP\/1\.1 200/.test(head), code);
      });
      sock.on('error', () => done(false, 'relay-unreachable'));
    });
  }

  async status(): Promise<RoutingStatus> {
    const { agentVpn } = this.getSettings();
    const support = this.provider.support();
    const snap = support.supported ? await this.snapshot().catch(() => null) : null;
    const base = {
      agentVpn,
      platform: this.provider.platform,
      support,
      vpnInterface: snap?.vpn?.name ?? null,
      directInterface: snap?.direct?.name ?? null,
      fullTunnel: snap?.fullTunnel ?? false,
    };
    if (!support.supported) return { ...base, state: 'unsupported', message: support.note ?? 'پشتیبانی نمی‌شود.' };
    if (!agentVpn) return { ...base, state: 'disabled', message: 'خاموش: همهٔ درخواست‌ها از مسیر پیش‌فرض سیستم‌عامل ارسال می‌شوند.' };
    if (!snap?.vpn) return { ...base, state: 'unavailable', message: MSG['vpn-missing'] };
    if (!snap.direct) return { ...base, state: 'unavailable', message: MSG['direct-missing'] };
    try {
      await this.relay.ensure();
    } catch {
      return { ...base, state: 'unavailable', message: MSG['helper-missing'] };
    }
    return { ...base, state: 'available', message: `Agentها از طریق VPN (${snap.vpn.name}) و Confluence مستقیم از طریق ${snap.direct.name}.` };
  }

  close() {
    this.relay.stop();
  }
}
