import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { networkInterfaces, release } from 'node:os';
import { join } from 'node:path';
import { findPython } from './python.ts';
import { summarize, type InterfaceKind, type NetInterface, type NetworkRoutingProvider, type PlatformSupport } from './types.ts';

// ARPHRD_* link types that are tunnels: PPP, IPIP, SIT, GRE, IP6 tunnels, and NONE (tun devices, WireGuard).
const TUNNEL_TYPES = new Set([512, 768, 769, 776, 778, 823, 65534]);
const IFF_UP = 0x1;
const IFF_TUN = 0x1;
const IFF_TAP = 0x2;

export interface LinuxOptions {
  /** Root of /sys and /proc; replaced by a fixture directory in tests. */
  root?: string;
  addresses?: () => NodeJS.Dict<{ address: string; internal: boolean }[]>;
  kernel?: string;
  python?: () => Promise<string[] | null>;
}

/** Kernel 5.7+ lets an unprivileged process use SO_BINDTODEVICE on an unbound socket. */
export function kernelAllowsUnprivilegedBind(kernel: string): boolean {
  const [major, minor] = kernel.split('.').map((n) => parseInt(n, 10));
  return major > 5 || (major === 5 && minor >= 7);
}

/**
 * Linux: reads interfaces from /sys/class/net and default routes from /proc/net/route (no commands, no root).
 * Interfaces are classified by kernel link type, never by name. Requests are pinned with SO_BINDTODEVICE by the relay.
 */
export class LinuxNetworkRoutingProvider implements NetworkRoutingProvider {
  readonly platform = 'linux';
  private readonly root: string;

  constructor(private readonly options: LinuxOptions = {}) {
    this.root = options.root ?? '/';
  }

  support(): PlatformSupport {
    const kernel = this.options.kernel ?? release();
    if (!kernelAllowsUnprivilegedBind(kernel)) {
      return { supported: false, verified: true, note: `کرنل ${kernel} قدیمی است؛ برای مسیریابی بدون دسترسی root کرنل 5.7 یا جدیدتر لازم است.` };
    }
    return { supported: true, verified: true };
  }

  private read(...parts: string[]): string | null {
    try {
      return readFileSync(join(this.root, ...parts), 'utf8').trim();
    } catch {
      return null;
    }
  }

  private defaultRoutes(): Map<string, number> {
    const routes = new Map<string, number>();
    const table = this.read('proc', 'net', 'route') ?? '';
    for (const line of table.split('\n').slice(1)) {
      const [iface, dest, , flags, , , metric, mask] = line.trim().split(/\s+/);
      if (!iface || dest !== '00000000' || mask !== '00000000' || !(parseInt(flags, 16) & IFF_UP)) continue;
      const m = parseInt(metric, 10);
      routes.set(iface, Math.min(routes.get(iface) ?? Infinity, m));
    }
    return routes;
  }

  private kind(name: string, hasDefault: boolean): InterfaceKind {
    const dir = ['sys', 'class', 'net', name];
    const type = parseInt(this.read(...dir, 'type') ?? '', 10);
    if (type === 772) return 'loopback';
    const tun = this.read(...dir, 'tun_flags');
    if (tun !== null) {
      const flags = parseInt(tun, 16);
      if (flags & IFF_TUN) return 'vpn';
      // TAP devices are usually VM / container plumbing; count one as a VPN only when it carries a default route.
      if (flags & IFF_TAP) return hasDefault ? 'vpn' : 'virtual';
    }
    if (/^DEVTYPE=wireguard$/m.test(this.read(...dir, 'uevent') ?? '')) return 'vpn';
    if (TUNNEL_TYPES.has(type)) return 'vpn';
    if (existsSync(join(this.root, ...dir, 'device'))) return 'physical';
    return 'virtual'; // bridges, veth, docker0, dummy…
  }

  async snapshot() {
    const routes = this.defaultRoutes();
    const addrs = (this.options.addresses ?? networkInterfaces)();
    let names: string[] = [];
    try {
      names = readdirSync(join(this.root, 'sys', 'class', 'net'));
    } catch {
      names = Object.keys(addrs);
    }
    const interfaces: NetInterface[] = names.map((name) => {
      const oper = this.read('sys', 'class', 'net', name, 'operstate');
      const flags = parseInt(this.read('sys', 'class', 'net', name, 'flags') ?? '0', 16);
      const metric = routes.get(name);
      return {
        name,
        pinId: name,
        kind: this.kind(name, metric !== undefined),
        up: Boolean(flags & IFF_UP) && (oper === 'up' || oper === 'unknown'),
        addresses: (addrs[name] ?? []).map((a) => a.address),
        defaultRoute: metric !== undefined,
        metric,
      };
    });
    return summarize(interfaces);
  }

  relayCommand() {
    return (this.options.python ?? (() => findPython(['python3'])))();
  }
}
