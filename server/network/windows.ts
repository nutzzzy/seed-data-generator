import { networkInterfaces } from 'node:os';
import { runCommand, type CommandRunner } from './exec.ts';
import { findPython } from './python.ts';
import { summarize, type InterfaceKind, type NetInterface, type NetworkRoutingProvider, type PlatformSupport } from './types.ts';

// IANA ifType values that are tunnels: PPP (23), proprietary virtual (53: WireGuard-NT, Wintun), tunnel (131).
const TUNNEL_IFTYPES = new Set([23, 53, 131]);
// Driver descriptions of common VPN adapters that present themselves as Ethernet (TAP-style drivers).
const VPN_DRIVER = /TAP-Windows|Wintun|WireGuard|OpenVPN|AnyConnect|Fortinet|PANGP|Juniper|Pulse Secure|SonicWall|NordLynx|Tunnel/i;

// One fixed, read-only PowerShell command; output is JSON. Nothing in it comes from user input.
const SCRIPT = [
  "$ErrorActionPreference='SilentlyContinue'",
  '$a = @(Get-NetAdapter -IncludeHidden | Select-Object Name,InterfaceIndex,InterfaceDescription,Status,InterfaceType,Virtual,HardwareInterface)',
  '$r = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix 0.0.0.0/0 | Select-Object InterfaceIndex,RouteMetric,@{n="InterfaceMetric";e={(Get-NetIPInterface -InterfaceIndex $_.InterfaceIndex -AddressFamily IPv4).InterfaceMetric}})',
  '@{adapters=$a; routes=$r} | ConvertTo-Json -Compress -Depth 3',
].join('; ');

interface Adapter {
  Name: string;
  InterfaceIndex: number;
  InterfaceDescription?: string;
  Status?: string;
  InterfaceType?: number;
  Virtual?: boolean;
  HardwareInterface?: boolean;
}

export interface WindowsOptions {
  run?: CommandRunner;
  addresses?: () => NodeJS.Dict<{ address: string }[]>;
  python?: () => Promise<string[] | null>;
}

export function classifyWindows(a: Adapter, hasDefault: boolean): InterfaceKind {
  if (a.InterfaceType === 24) return 'loopback';
  if (TUNNEL_IFTYPES.has(a.InterfaceType ?? -1) || VPN_DRIVER.test(a.InterfaceDescription ?? '')) return 'vpn';
  if (a.HardwareInterface) return 'physical';
  // A non-hardware adapter that is not a known VM switch and carries a default route is most likely a VPN.
  if (hasDefault && !/Hyper-V|VMware|VirtualBox|vEthernet/i.test(`${a.Name} ${a.InterfaceDescription ?? ''}`)) return 'vpn';
  return 'virtual';
}

/**
 * Windows 10 / 11: adapters and default routes from Get-NetAdapter / Get-NetRoute (read-only, no admin).
 * Requests are pinned with IP_UNICAST_IF by the relay. NOT yet validated on a real Windows machine.
 */
export class WindowsNetworkRoutingProvider implements NetworkRoutingProvider {
  readonly platform = 'win32';

  constructor(private readonly options: WindowsOptions = {}) {}

  support(): PlatformSupport {
    return {
      supported: true,
      verified: false,
      note: 'روی Windows پیاده‌سازی شده اما هنوز روی یک دستگاه واقعی آزمایش نشده است. VPNهایی که ترافیک خارج از تونل را با Windows Filtering Platform مسدود می‌کنند (kill switch) مسیر مستقیم را هم می‌بندند.',
    };
  }

  async snapshot() {
    const out = await (this.options.run ?? runCommand)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT]);
    let parsed: { adapters?: Adapter[] | Adapter; routes?: { InterfaceIndex: number; RouteMetric: number; InterfaceMetric?: number }[] | null } = {};
    try {
      parsed = out ? JSON.parse(out) : {};
    } catch {
      /* treated as no interfaces */
    }
    const list = <T,>(v: T[] | T | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);
    const metrics = new Map<number, number>();
    for (const r of list(parsed.routes)) {
      const m = (r.RouteMetric ?? 0) + (r.InterfaceMetric ?? 0); // Windows uses the sum to pick a route
      metrics.set(r.InterfaceIndex, Math.min(metrics.get(r.InterfaceIndex) ?? Infinity, m));
    }
    const addrs = (this.options.addresses ?? networkInterfaces)();
    const interfaces: NetInterface[] = list(parsed.adapters).map((a) => {
      const metric = metrics.get(a.InterfaceIndex);
      return {
        name: a.Name,
        pinId: String(a.InterfaceIndex),
        kind: classifyWindows(a, metric !== undefined),
        up: a.Status === 'Up',
        addresses: (addrs[a.Name] ?? []).map((x) => x.address),
        defaultRoute: metric !== undefined,
        metric,
      };
    });
    return summarize(interfaces);
  }

  relayCommand() {
    return (this.options.python ?? (() => findPython([['py', '-3'], 'python', 'python3'])))();
  }
}
