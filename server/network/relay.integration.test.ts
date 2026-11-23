// @vitest-environment node
// INTEGRATION test (Linux only): the real relay helper (python3) + undici ProxyAgent + RoutedHttpClient, against a
// local HTTP server. Sockets are pinned to the loopback interface "lo", so it needs no VPN and no internet.
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoutedHttpClient } from './httpClient.ts';
import { RelayProcess, type RelayEndpoint } from './relay.ts';
import { NetworkRouteError, type NetworkRouter } from './router.ts';
import type { NetInterface } from './types.ts';

const hasPython = (() => {
  try {
    execFileSync('python3', ['-c', 'pass']);
    return true;
  } catch {
    return false;
  }
})();

const LO: NetInterface = { name: 'lo', pinId: 'lo', kind: 'loopback', up: true, addresses: ['127.0.0.1'], defaultRoute: false };

describe.runIf(process.platform === 'linux' && hasPython)('relay helper (real sockets)', () => {
  let server: Server;
  let base: string;
  let relay: RelayProcess;
  let endpoint: RelayEndpoint;
  let pin = LO;
  let vpnGone = false;
  const seen: string[] = [];

  /** Router stand-in: always pins (even to loopback) so the transport itself is exercised. */
  const router = {
    binding: async () => ({ kind: 'pinned' as const, iface: pin, relay: endpoint }),
    explainFailure: async () => (vpnGone ? new NetworkRouteError('vpn-dropped', 'VPN dropped') : null),
    childEnv: async () => ({}),
  } as unknown as NetworkRouter;
  const client = new RoutedHttpClient('agent', router);

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url} auth=${req.headers.authorization ?? ''}`);
      if (req.url === '/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        let n = 0;
        const t = setInterval(() => {
          res.write(`data: ${n}\n\n`);
          if (++n === 5) {
            clearInterval(t);
            res.end();
          }
        }, 60);
        req.on('close', () => clearInterval(t));
      } else if (req.url === '/hang') {
        /* never answers */
      } else if (req.url === '/drop') {
        req.socket.destroy();
      } else {
        res.end(JSON.stringify({ ok: true }));
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    relay = new RelayProcess(async () => ['python3', '-I']);
    endpoint = await relay.ensure();
  });

  afterAll(() => {
    relay.stop();
    server.close();
  });

  it('tunnels a request through the pinned interface, passing headers end to end', async () => {
    const res = await client.fetch(`${base}/hello`, { headers: { Authorization: 'Bearer secret' } });
    expect(await res.json()).toEqual({ ok: true });
    expect(seen.at(-1)).toBe('GET /hello auth=Bearer secret');
  });

  it('streams responses incrementally', async () => {
    const res = await client.fetch(`${base}/stream`);
    const reader = res.body!.getReader();
    const started = Date.now();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('data: 0');
    expect(Date.now() - started).toBeLessThan(250); // the first event arrives before the stream ends (~300 ms)
    let rest = '';
    for (let r = await reader.read(); !r.done; r = await reader.read()) rest += new TextDecoder().decode(r.value);
    expect(rest).toContain('data: 4');
  });

  it('cancels a streaming request with AbortSignal', async () => {
    const ac = new AbortController();
    const res = await client.fetch(`${base}/stream`, { signal: ac.signal });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out a hanging request', async () => {
    await expect(client.fetch(`${base}/hang`, { signal: AbortSignal.timeout(300) })).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('a VPN drop during the request becomes a clear route error (no retry elsewhere)', async () => {
    vpnGone = true;
    try {
      await expect(client.fetch(`${base}/drop`)).rejects.toMatchObject({ code: 'vpn-dropped' });
    } finally {
      vpnGone = false;
    }
  });

  it('fails when the pinned interface does not exist instead of using another route', async () => {
    pin = { ...LO, name: 'gone0', pinId: 'gone0' };
    try {
      const before = seen.length;
      await expect(client.fetch(`${base}/hello`)).rejects.toThrow();
      expect(seen.length).toBe(before); // nothing reached the server
    } finally {
      pin = LO;
    }
  });

  it('rejects tunnels without the token and non-CONNECT requests', async () => {
    const raw = async (head: string) => {
      const { connect } = await import('node:net');
      return new Promise<string>((resolve) => {
        const s = connect(endpoint.port, '127.0.0.1', () => s.write(head));
        s.once('data', (d) => {
          resolve(d.toString());
          s.destroy();
        });
      });
    };
    const target = base.replace('http://', '');
    expect(await raw(`CONNECT ${target} HTTP/1.1\r\n\r\n`)).toMatch(/^HTTP\/1\.1 407/);
    const wrong = Buffer.from('lo:wrong-token').toString('base64');
    expect(await raw(`CONNECT ${target} HTTP/1.1\r\nProxy-Authorization: Basic ${wrong}\r\n\r\n`)).toMatch(/^HTTP\/1\.1 407/);
    expect(await raw(`GET ${base}/hello HTTP/1.1\r\n\r\n`)).toMatch(/^HTTP\/1\.1 405/);
    const badIface = Buffer.from(`lo;rm -rf:${endpoint.token}`).toString('base64');
    expect(await raw(`CONNECT ${target} HTTP/1.1\r\nProxy-Authorization: Basic ${badIface}\r\n\r\n`)).toMatch(/^HTTP\/1\.1 400/);
  });

  it('restarts the helper after it exits (new port and token)', async () => {
    relay.stop();
    const next = await relay.ensure();
    expect(next.token).not.toBe(endpoint.token);
    endpoint = next;
    const res = await client.fetch(`${base}/hello`);
    expect(res.ok).toBe(true);
  });
});
