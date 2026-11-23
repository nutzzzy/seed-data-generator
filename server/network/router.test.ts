// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UnsupportedNetworkRoutingProvider } from './index.ts';
import { isLocalDestination, NetworkRouteError, NetworkRouter } from './router.ts';
import { summarize, type NetInterface, type NetworkRoutingProvider } from './types.ts';

const iface = (name: string, kind: NetInterface['kind'], extra: Partial<NetInterface> = {}): NetInterface => ({
  name,
  pinId: name,
  kind,
  up: true,
  addresses: ['10.0.0.2'],
  defaultRoute: true,
  metric: 100,
  ...extra,
});

/** A provider whose interface list the test changes over time (VPN up / down / renamed). */
function fakeProvider(initial: NetInterface[]) {
  let interfaces = initial;
  const provider: NetworkRoutingProvider = {
    platform: 'test',
    support: () => ({ supported: true, verified: true }),
    snapshot: vi.fn(async () => summarize(interfaces)),
    relayCommand: async () => null,
  };
  return { provider, set: (next: NetInterface[]) => (interfaces = next) };
}

const relay = () => ({ ensure: vi.fn(async () => ({ port: 4000, token: 't'.repeat(32) })), stop: vi.fn() });
const dir = () => mkdtempSync(join(tmpdir(), 'net-router-'));
const WIFI = iface('wlan0', 'physical', { metric: 600 });
const VPN = iface('tun0', 'vpn', { metric: 1 });
const API = new URL('https://api.anthropic.com/v1/messages');
const CONF = new URL('https://confluence.example.com/rest/api/content/1');

describe('NetworkRouter', () => {
  it('is off by default: every request uses the OS route and the relay is never started', async () => {
    const r = relay();
    const router = new NetworkRouter(dir(), fakeProvider([WIFI, VPN]).provider, { relay: r });
    expect(router.getSettings()).toEqual({ agentVpn: false });
    expect(await router.binding('agent', API)).toEqual({ kind: 'default' });
    expect(await router.binding('confluence', CONF)).toEqual({ kind: 'default' });
    expect(await router.childEnv()).toEqual({});
    expect((await router.status()).state).toBe('disabled');
    expect(r.ensure).not.toHaveBeenCalled();
  });

  it('when on, pins agent requests to the VPN and Confluence requests to the direct interface', async () => {
    const router = new NetworkRouter(dir(), fakeProvider([WIFI, VPN]).provider, { relay: relay() });
    router.setSettings({ agentVpn: true });
    const agent = await router.binding('agent', API);
    const confluence = await router.binding('confluence', CONF);
    expect(agent).toMatchObject({ kind: 'pinned', iface: { name: 'tun0' } });
    expect(confluence).toMatchObject({ kind: 'pinned', iface: { name: 'wlan0' } });
    const status = await router.status();
    expect(status).toMatchObject({ state: 'available', vpnInterface: 'tun0', directInterface: 'wlan0', fullTunnel: true });
  });

  it('never falls back to the normal route when the VPN is not connected', async () => {
    const router = new NetworkRouter(dir(), fakeProvider([WIFI]).provider, { relay: relay() });
    router.setSettings({ agentVpn: true });
    await expect(router.binding('agent', API)).rejects.toMatchObject({ name: 'NetworkRouteError', code: 'vpn-missing', status: 503 });
    await expect(router.childEnv()).rejects.toBeInstanceOf(NetworkRouteError);
    // Confluence still works directly, and the status separates the setting from the connection.
    expect(await router.binding('confluence', CONF)).toMatchObject({ kind: 'pinned', iface: { name: 'wlan0' } });
    expect(await router.status()).toMatchObject({ agentVpn: true, state: 'unavailable', vpnInterface: null });
  });

  it('follows VPN disconnection, reconnection and an interface change without restarting', async () => {
    const { provider, set } = fakeProvider([WIFI, VPN]);
    const router = new NetworkRouter(dir(), provider, { relay: relay(), cacheMs: 0 });
    router.setSettings({ agentVpn: true });
    expect(await router.binding('agent', API)).toMatchObject({ iface: { name: 'tun0' } });
    set([WIFI]);
    await expect(router.binding('agent', API)).rejects.toMatchObject({ code: 'vpn-missing' });
    set([WIFI, iface('wg0', 'vpn', { metric: 5 })]);
    expect(await router.binding('agent', API)).toMatchObject({ iface: { name: 'wg0' } });
  });

  it('explains a failed pinned request: VPN gone or replaced -> vpn-dropped; relay refused pinning -> pin-failed', async () => {
    const { provider, set } = fakeProvider([WIFI, VPN]);
    const router = new NetworkRouter(dir(), provider, { relay: relay(), cacheMs: 0 });
    router.setSettings({ agentVpn: true });
    expect(await router.explainFailure('agent', VPN, new Error('socket hang up'))).toBeNull();
    expect(await router.explainFailure('agent', VPN, new Error('Proxy response (502) !== 200 when HTTP Tunneling'))).toMatchObject({ code: 'pin-failed' });
    set([WIFI]);
    expect(await router.explainFailure('agent', VPN, new Error('x'))).toMatchObject({ code: 'vpn-dropped' });
    expect(await router.explainAgentFailure()).toMatchObject({ code: 'vpn-dropped' });
    set([WIFI, iface('tun1', 'vpn')]);
    expect(await router.explainFailure('agent', VPN, new Error('x'))).toMatchObject({ code: 'vpn-dropped' });
    set([VPN]);
    expect(await router.explainFailure('confluence', WIFI, new Error('x'))).toMatchObject({ code: 'direct-dropped' });
  });

  it('keeps local destinations (Ollama, LM Studio, LAN) on the OS route even when on', async () => {
    const router = new NetworkRouter(dir(), fakeProvider([WIFI]).provider, { relay: relay() });
    router.setSettings({ agentVpn: true });
    expect(await router.binding('agent', new URL('http://localhost:11434/api/chat'))).toEqual({ kind: 'default' });
    for (const u of ['http://127.0.0.1:1234', 'http://192.168.1.5:8000', 'http://[::1]:11434', 'http://box.local']) expect(isLocalDestination(new URL(u))).toBe(true);
    for (const u of ['https://api.openai.com', 'https://8.8.8.8']) expect(isLocalDestination(new URL(u))).toBe(false);
  });

  it('persists the setting across restarts in a private file and stops the relay when turned off', () => {
    const d = dir();
    const r = relay();
    new NetworkRouter(d, fakeProvider([]).provider, { relay: r }).setSettings({ agentVpn: true });
    expect(JSON.parse(readFileSync(join(d, 'network.json'), 'utf8'))).toEqual({ version: 1, agentVpn: true });
    const again = new NetworkRouter(d, fakeProvider([]).provider, { relay: r });
    expect(again.getSettings().agentVpn).toBe(true);
    again.setSettings({ agentVpn: false });
    expect(r.stop).toHaveBeenCalled();
    expect(() => again.setSettings({ agentVpn: 'yes' })).toThrow(/true یا false/);
  });

  it('reports a missing helper (no Python) as unavailable instead of pretending', async () => {
    const r = { ensure: vi.fn(async () => Promise.reject(new Error('python-missing'))), stop: vi.fn() };
    const router = new NetworkRouter(dir(), fakeProvider([WIFI, VPN]).provider, { relay: r });
    router.setSettings({ agentVpn: true });
    await expect(router.binding('agent', API)).rejects.toMatchObject({ code: 'helper-missing' });
    expect(await router.status()).toMatchObject({ state: 'unavailable' });
  });

  it('on an unsupported platform the setting cannot be enabled and nothing changes', async () => {
    const d = dir();
    const router = new NetworkRouter(d, new UnsupportedNetworkRoutingProvider('aix'), { relay: relay() });
    expect(() => router.setSettings({ agentVpn: true })).toThrow(NetworkRouteError);
    expect(existsSync(join(d, 'network.json'))).toBe(false);
    expect(await router.binding('agent', API)).toEqual({ kind: 'default' });
    expect((await router.status()).state).toBe('unsupported');
  });

  it('gives CLI agents proxy variables for their own process only (agent path, loopback excluded)', async () => {
    const before = { ...process.env };
    const router = new NetworkRouter(dir(), fakeProvider([WIFI, VPN]).provider, { relay: relay() });
    router.setSettings({ agentVpn: true });
    const env = await router.childEnv();
    expect(env.HTTPS_PROXY).toBe(`http://tun0:${'t'.repeat(32)}@127.0.0.1:4000`);
    expect(env.NO_PROXY).toContain('localhost');
    expect(process.env).toEqual(before); // nothing set process-wide
  });
});

describe('summarize', () => {
  it('picks the VPN with the best route, the direct physical default route, and detects a full tunnel', () => {
    const snap = summarize([WIFI, VPN, iface('docker0', 'virtual', { defaultRoute: false }), iface('eth0', 'physical', { up: false })]);
    expect(snap).toMatchObject({ vpn: { name: 'tun0' }, direct: { name: 'wlan0' }, fullTunnel: true });
    const split = summarize([WIFI, iface('tun0', 'vpn', { defaultRoute: false, metric: undefined })]);
    expect(split).toMatchObject({ vpn: { name: 'tun0' }, fullTunnel: false });
    // A tunnel with only a link-local address (macOS system utun) is not a connected VPN.
    expect(summarize([WIFI, iface('utun0', 'vpn', { addresses: ['fe80::1'] })]).vpn).toBeNull();
  });
});
