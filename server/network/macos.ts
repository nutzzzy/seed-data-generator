import { networkInterfaces } from 'node:os';
import { runCommand, type CommandRunner } from './exec.ts';
import { findPython } from './python.ts';
import { summarize, type InterfaceKind, type NetInterface, type NetworkRoutingProvider, type PlatformSupport } from './types.ts';

// On macOS the interface name prefix is the kernel driver family: utun (Network Extension / WireGuard / IKEv2 tunnels),
// ipsec, ppp (L2TP / PPTP), tun / tap (third-party kexts). This identifies the type, not a particular VPN product.
const TUNNEL_FAMILY = /^(utun|ipsec|ppp|tun|tap)\d+$/;

export interface MacOptions {
  run?: CommandRunner;
  addresses?: () => NodeJS.Dict<{ address: string }[]>;
  python?: () => Promise<string[] | null>;
}

/** Default routes from `netstat -rn -f inet`, in table order; interface-scoped duplicates (flag I) are skipped. */
export function parseMacDefaults(netstat: string): string[] {
  const out: string[] = [];
  for (const line of netstat.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== 'default' || cols.length < 4) continue;
    const [, , flags, iface] = cols;
    if (flags.includes('I') || out.includes(iface)) continue;
    out.push(iface);
  }
  return out;
}

/** Device names of hardware ports from `networksetup -listallhardwareports`. */
export function parseHardwarePorts(text: string): Set<string> {
  return new Set([...text.matchAll(/^Device:\s*(\S+)/gm)].map((m) => m[1]));
}

/**
 * macOS: interfaces from os.networkInterfaces, hardware ports from networksetup, default routes from netstat
 * (all read-only, no admin). Requests are pinned with IP_BOUND_IF by the relay. NOT yet validated on a real Mac.
 */
export class MacOSNetworkRoutingProvider implements NetworkRoutingProvider {
  readonly platform = 'darwin';

  constructor(private readonly options: MacOptions = {}) {}

  support(): PlatformSupport {
    return {
      supported: true,
      verified: false,
      note: 'روی macOS پیاده‌سازی شده اما هنوز روی یک Mac واقعی آزمایش نشده است. VPNهایی که با includeAllNetworks / enforceRoutes همهٔ ترافیک را اجباری می‌کنند، مسیر مستقیم را می‌بندند.',
    };
  }

  async snapshot() {
    const run = this.options.run ?? runCommand;
    const [netstat, ports] = await Promise.all([run('/usr/sbin/netstat', ['-rn', '-f', 'inet']), run('/usr/sbin/networksetup', ['-listallhardwareports'])]);
    const defaults = parseMacDefaults(netstat ?? '');
    const hardware = parseHardwarePorts(ports ?? '');
    const addrs = (this.options.addresses ?? networkInterfaces)();
    const interfaces: NetInterface[] = Object.entries(addrs).map(([name, list]) => {
      const order = defaults.indexOf(name);
      const kind: InterfaceKind = name.startsWith('lo') ? 'loopback' : TUNNEL_FAMILY.test(name) ? 'vpn' : hardware.has(name) ? 'physical' : 'virtual';
      return {
        name,
        pinId: name,
        kind,
        up: true, // os.networkInterfaces only lists interfaces that have addresses
        addresses: (list ?? []).map((a) => a.address),
        defaultRoute: order >= 0,
        metric: order >= 0 ? order : undefined,
      };
    });
    return summarize(interfaces);
  }

  relayCommand() {
    return (this.options.python ?? (() => findPython(['python3', '/usr/bin/python3'])))();
  }
}
