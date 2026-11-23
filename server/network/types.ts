/**
 * Platform-independent network routing types. Business logic (agents, Confluence) only sees these; OS-specific
 * detection lives in the NetworkRoutingProvider implementations (linux.ts, windows.ts, macos.ts).
 */

export type InterfaceKind = 'vpn' | 'physical' | 'loopback' | 'virtual';

export interface NetInterface {
  /** Display name, e.g. wlo1, utun4, "Wi-Fi". */
  name: string;
  /** What the relay helper pins to: the interface name (Linux / macOS) or its index (Windows). */
  pinId: string;
  kind: InterfaceKind;
  up: boolean;
  addresses: string[];
  /** The interface carries an IPv4 default route. */
  defaultRoute: boolean;
  /** Metric of that default route (lower wins). */
  metric?: number;
}

export interface NetworkSnapshot {
  interfaces: NetInterface[];
  /** The connected VPN interface to send agent traffic through, or null when no VPN is up. */
  vpn: NetInterface | null;
  /** The normal (non-VPN) interface with the best default route, or null when there is none. */
  direct: NetInterface | null;
  /** The OS default route currently goes through the VPN. */
  fullTunnel: boolean;
}

export interface PlatformSupport {
  supported: boolean;
  /** Tested on a real machine of this platform (false = implemented but not yet validated). */
  verified: boolean;
  /** Why it is unsupported, or what still needs manual validation. */
  note?: string;
}

/** One implementation per operating system. Adding an OS = one more implementation in index.ts. */
export interface NetworkRoutingProvider {
  readonly platform: string;
  support(): PlatformSupport;
  /** Interfaces, the VPN interface and the direct interface right now (called per request, cached briefly). */
  snapshot(): Promise<NetworkSnapshot>;
  /** Command that runs the relay helper (python interpreter + leading args), or null when none is available. */
  relayCommand(): Promise<string[] | null>;
}

export type RoutePurpose = 'agent' | 'confluence';

/** How one request leaves the machine. */
export type RouteBinding =
  | { kind: 'default' }
  | { kind: 'pinned'; iface: NetInterface; relay: { port: number; token: string } };

export type RoutingState = 'disabled' | 'available' | 'unavailable' | 'unsupported';

export interface RoutingStatus {
  /** The saved setting, independent of the VPN connection. */
  agentVpn: boolean;
  state: RoutingState;
  platform: string;
  support: PlatformSupport;
  vpnInterface: string | null;
  directInterface: string | null;
  fullTunnel: boolean;
  message: string;
}

/** Picks the VPN and direct interfaces from a list; shared by all providers so the choice is consistent. */
export function summarize(interfaces: NetInterface[]): NetworkSnapshot {
  // Link-local IPv6 alone (macOS system utun devices, idle adapters) does not make an interface usable.
  const usable = (i: NetInterface) => i.up && i.addresses.some((a) => !/^fe80:/i.test(a));
  const byMetric = (a: NetInterface, b: NetInterface) => Number(b.defaultRoute) - Number(a.defaultRoute) || (a.metric ?? 1e9) - (b.metric ?? 1e9);
  const vpns = interfaces.filter((i) => i.kind === 'vpn' && usable(i)).sort(byMetric);
  const direct = interfaces.filter((i) => i.kind === 'physical' && usable(i) && i.defaultRoute).sort(byMetric)[0] ?? null;
  const best = interfaces.filter((i) => i.defaultRoute && usable(i)).sort(byMetric)[0];
  return { interfaces, vpn: vpns[0] ?? null, direct, fullTunnel: best?.kind === 'vpn' };
}
