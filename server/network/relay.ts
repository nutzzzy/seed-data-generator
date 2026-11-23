import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RELAY_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'relay.py');

export interface RelayEndpoint {
  port: number;
  token: string;
}

/**
 * Starts the relay helper (relay.py) on demand and keeps it running; restarts it if it exits. The helper runs with
 * the app's own (non-admin) rights, listens on 127.0.0.1 only and exits when this process goes away.
 */
export class RelayProcess {
  private child: ChildProcessWithoutNullStreams | null = null;
  private ready: Promise<RelayEndpoint> | null = null;

  constructor(private readonly command: () => Promise<string[] | null>) {}

  ensure(): Promise<RelayEndpoint> {
    return (this.ready ??= this.start().catch((err: unknown) => {
      this.ready = null;
      throw err;
    }));
  }

  private async start(): Promise<RelayEndpoint> {
    const cmd = await this.command();
    if (!cmd) throw new Error('python-missing');
    const token = randomBytes(24).toString('base64url');
    const [bin, ...args] = cmd;
    // Only PATH-like basics are inherited; the token goes through the environment, never the command line.
    const env: NodeJS.ProcessEnv = { SEED_RELAY_TOKEN: token, PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT };
    const child = spawn(bin, [...args, RELAY_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
    this.child = child;
    child.on('exit', () => {
      if (this.child === child) {
        this.child = null;
        this.ready = null;
      }
    });
    child.stderr.resume();
    return new Promise<RelayEndpoint>((resolve, reject) => {
      let out = '';
      const timer = setTimeout(() => fail('relay-timeout'), 8000);
      const fail = (why: string) => {
        clearTimeout(timer);
        child.kill();
        reject(new Error(why));
      };
      child.on('error', () => fail('relay-spawn-failed'));
      child.on('exit', () => fail('relay-exited'));
      child.stdout.on('data', (d: Buffer) => {
        out += d.toString('utf8');
        const m = /^READY (\d+)$/m.exec(out);
        if (m) {
          clearTimeout(timer);
          resolve({ port: Number(m[1]), token });
        }
      });
    });
  }

  stop() {
    this.child?.kill();
    this.child = null;
    this.ready = null;
  }
}
