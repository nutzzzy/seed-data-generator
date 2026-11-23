// @vitest-environment node
// Platform adapters against recorded OS output. These are UNIT tests: they prove the parsing and classification,
// not that routing works on the real OS (Linux is additionally verified by relay.integration.test.ts).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRoutingProvider, UnsupportedNetworkRoutingProvider } from './index.ts';
import { kernelAllowsUnprivilegedBind, LinuxNetworkRoutingProvider } from './linux.ts';
import { MacOSNetworkRoutingProvider, parseHardwarePorts, parseMacDefaults } from './macos.ts';
import { classifyWindows, WindowsNetworkRoutingProvider } from './windows.ts';

/** A /sys + /proc fixture shaped like this project's dev machine (Happ / xray TUN full tunnel over Wi-Fi). */
function linuxFixture(devices: Record<string, Record<string, string | true>>, routes: string): string {
  const root = mkdtempSync(join(tmpdir(), 'sysfs-'));
  for (const [name, files] of Object.entries(devices)) {
    const d = join(root, 'sys', 'class', 'net', name);
    mkdirSync(d, { recursive: true });
    for (const [f, v] of Object.entries(files)) {
      if (v === true) mkdirSync(join(d, f));
      else writeFileSync(join(d, f), `${v}\n`);
    }
  }
  mkdirSync(join(root, 'proc', 'net'), { recursive: true });
  writeFileSync(join(root, 'proc', 'net', 'route'), `Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n${routes}`);
  return root;
}

const ADDRS = {
  lo: [{ address: '127.0.0.1', internal: true }],
  wlo1: [{ address: '10.100.40.217', internal: false }],
  'happ-xray': [{ address: '172.19.0.1', internal: false }],
  wg0: [{ address: '10.8.0.2', internal: false }],
  docker0: [{ address: '172.17.0.1', internal: false }],
  vnet3: [{ address: '192.168.122.9', internal: false }],
};

describe('Linux adapter', () => {
  const devices: Record<string, Record<string, string | true>> = {
    lo: { type: '772', operstate: 'unknown', flags: '0x9' },
    wlo1: { type: '1', operstate: 'up', flags: '0x1003', device: true },
    eno2: { type: '1', operstate: 'down', flags: '0x1003', device: true },
    'happ-xray': { type: '65534', operstate: 'unknown', flags: '0x1091', tun_flags: '0x1001' },
    wg0: { type: '65534', operstate: 'unknown', flags: '0x91', uevent: 'DEVTYPE=wireguard\nINTERFACE=wg0' },
    docker0: { type: '1', operstate: 'up', flags: '0x1003' },
    vnet3: { type: '1', operstate: 'up', flags: '0x1003', tun_flags: '0x1002' },
  };

  it('classifies by kernel link type (not name) and reads default routes from /proc/net/route', async () => {
    const root = linuxFixture(
      devices,
      'happ-xray\t00000000\t00000000\t0001\t0\t0\t1\t00000000\t0\t0\t0\nwlo1\t00000000\t0228640A\t0003\t0\t0\t600\t00000000\t0\t0\t0\nwlo1\t0028640A\t00000000\t0001\t0\t0\t600\t00FEFFFF\t0\t0\t0\n',
    );
    const p = new LinuxNetworkRoutingProvider({ root, addresses: () => ADDRS, kernel: '7.0.0-42-generic' });
    const snap = await p.snapshot();
    const kinds = Object.fromEntries(snap.interfaces.map((i) => [i.name, i.kind]));
    expect(kinds).toEqual({ lo: 'loopback', wlo1: 'physical', eno2: 'physical', 'happ-xray': 'vpn', wg0: 'vpn', docker0: 'virtual', vnet3: 'virtual' });
    expect(snap.vpn?.name).toBe('happ-xray'); // the VPN with the default route wins over the idle wg0
    expect(snap.direct?.name).toBe('wlo1');
    expect(snap.fullTunnel).toBe(true);
    expect(snap.interfaces.find((i) => i.name === 'eno2')?.up).toBe(false);
  });

  it('split tunnel: VPN without default route is still found, and the default route stays direct', async () => {
    const root = linuxFixture(devices, 'wlo1\t00000000\t0228640A\t0003\t0\t0\t600\t00000000\t0\t0\t0\nwg0\t0000080A\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0\n');
    const snap = await new LinuxNetworkRoutingProvider({ root, addresses: () => ({ ...ADDRS, 'happ-xray': [] }), kernel: '6.8.0' }).snapshot();
    expect(snap).toMatchObject({ vpn: { name: 'wg0' }, direct: { name: 'wlo1' }, fullTunnel: false });
  });

  it('no VPN interface up -> vpn null', async () => {
    const root = linuxFixture({ lo: devices.lo, wlo1: devices.wlo1 }, 'wlo1\t00000000\t0228640A\t0003\t0\t0\t600\t00000000\t0\t0\t0\n');
    const snap = await new LinuxNetworkRoutingProvider({ root, addresses: () => ADDRS }).snapshot();
    expect(snap.vpn).toBeNull();
  });

  it('needs kernel 5.7+ for unprivileged SO_BINDTODEVICE', () => {
    expect(kernelAllowsUnprivilegedBind('5.4.0-150-generic')).toBe(false);
    expect(kernelAllowsUnprivilegedBind('5.7.0')).toBe(true);
    expect(new LinuxNetworkRoutingProvider({ kernel: '4.19.0' }).support().supported).toBe(false);
  });

  it.runIf(process.platform === 'linux')('reads this machine without errors (real /sys, read-only)', async () => {
    const snap = await new LinuxNetworkRoutingProvider().snapshot();
    expect(snap.interfaces.some((i) => i.kind === 'loopback')).toBe(true);
    expect(new LinuxNetworkRoutingProvider().support().supported).toBe(kernelAllowsUnprivilegedBind(release()));
  });
});

describe('Windows adapter (mocked PowerShell output; needs validation on Windows)', () => {
  const ps = JSON.stringify({
    adapters: [
      { Name: 'Wi-Fi', InterfaceIndex: 12, InterfaceDescription: 'Intel(R) Wi-Fi 6 AX201', Status: 'Up', InterfaceType: 71, Virtual: false, HardwareInterface: true },
      { Name: 'WireGuard Tunnel', InterfaceIndex: 31, InterfaceDescription: 'WireGuard Tunnel', Status: 'Up', InterfaceType: 53, Virtual: true, HardwareInterface: false },
      { Name: 'vEthernet (WSL)', InterfaceIndex: 40, InterfaceDescription: 'Hyper-V Virtual Ethernet Adapter', Status: 'Up', InterfaceType: 6, Virtual: true, HardwareInterface: false },
    ],
    routes: [
      { InterfaceIndex: 12, RouteMetric: 0, InterfaceMetric: 35 },
      { InterfaceIndex: 31, RouteMetric: 0, InterfaceMetric: 5 },
    ],
  });
  const addresses = () => ({ 'Wi-Fi': [{ address: '192.168.1.20' }], 'WireGuard Tunnel': [{ address: '10.7.0.2' }], 'vEthernet (WSL)': [{ address: '172.28.0.1' }] });

  it('maps adapters to interfaces pinned by index and picks VPN / direct by route metric', async () => {
    const p = new WindowsNetworkRoutingProvider({ run: async () => ps, addresses });
    const snap = await p.snapshot();
    expect(snap.vpn).toMatchObject({ name: 'WireGuard Tunnel', pinId: '31' });
    expect(snap.direct).toMatchObject({ name: 'Wi-Fi', pinId: '12' });
    expect(snap.fullTunnel).toBe(true);
    expect(snap.interfaces.find((i) => i.pinId === '40')?.kind).toBe('virtual');
    expect(p.support()).toMatchObject({ supported: true, verified: false });
  });

  it('recognises TAP-style VPN drivers and PowerShell failure', async () => {
    expect(classifyWindows({ Name: 'Ethernet 3', InterfaceIndex: 9, InterfaceDescription: 'TAP-Windows Adapter V9', InterfaceType: 6 }, false)).toBe('vpn');
    const snap = await new WindowsNetworkRoutingProvider({ run: async () => null, addresses }).snapshot();
    expect(snap).toMatchObject({ vpn: null, direct: null });
  });
});

describe('macOS adapter (mocked command output; needs validation on macOS)', () => {
  const netstat = `Routing tables

Internet:
Destination        Gateway            Flags           Netif Expire
default            link#24            UCSg            utun4
default            192.168.1.1        UGScg             en0
default            link#24            UCSIg           utun4
127                127.0.0.1          UCS               lo0
`;
  const ports = 'Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: aa\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\n';
  const addresses = () => ({ lo0: [{ address: '127.0.0.1' }], en0: [{ address: '192.168.1.7' }], utun4: [{ address: '10.2.0.2' }], utun0: [{ address: 'fe80::1' }], awdl0: [{ address: 'fe80::2' }] });

  it('parses default routes (skipping interface-scoped ones) and hardware ports', () => {
    expect(parseMacDefaults(netstat)).toEqual(['utun4', 'en0']);
    expect([...parseHardwarePorts(ports)]).toEqual(['en0', 'bridge0']);
  });

  it('finds the utun VPN, ignores system utun devices with only link-local addresses', async () => {
    const run = async (bin: string) => (bin.endsWith('netstat') ? netstat : ports);
    const snap = await new MacOSNetworkRoutingProvider({ run, addresses }).snapshot();
    expect(snap).toMatchObject({ vpn: { name: 'utun4' }, direct: { name: 'en0' }, fullTunnel: true });
  });
});

describe('platform selection', () => {
  it('picks the adapter per OS and an unsupported one otherwise', () => {
    expect(createRoutingProvider('linux')).toBeInstanceOf(LinuxNetworkRoutingProvider);
    expect(createRoutingProvider('win32')).toBeInstanceOf(WindowsNetworkRoutingProvider);
    expect(createRoutingProvider('darwin')).toBeInstanceOf(MacOSNetworkRoutingProvider);
    expect(createRoutingProvider('freebsd')).toBeInstanceOf(UnsupportedNetworkRoutingProvider);
  });
});
