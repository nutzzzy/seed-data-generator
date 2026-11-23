import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Where the local server keeps agent configs and secrets. Inside the project by default (`.data/`, gitignored);
 * SEED_DATA_DIR moves it elsewhere, e.g. ~/.config/seed-data-generator.
 */
export function resolveDataDir(env: Record<string, string | undefined> = process.env): string {
  return resolve(env.SEED_DATA_DIR || join(process.cwd(), '.data'));
}

/** Writes via a temp file + rename so a crash never leaves a half-written file; readable by the owner only. */
export function writePrivateFile(file: string, content: string | Buffer) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {
    /* not supported on every file system */
  }
}

export function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

/**
 * Secrets (API keys, tokens) for the local server, encrypted at rest with AES-256-GCM.
 * The key comes from SEED_SECRET_KEY (base64, 32 bytes) or a generated `secret.key` next to the data.
 * Values are only ever read by server code; the HTTP API exposes `has()` and `masked()` and never the value.
 */
export class SecretStore {
  private cache: Record<string, string> | null = null;

  constructor(
    private readonly dir: string,
    private readonly envKey?: string,
  ) {}

  private get file() {
    return join(this.dir, 'secrets.json');
  }

  private key(): Buffer {
    if (this.envKey) {
      const k = Buffer.from(this.envKey, 'base64');
      if (k.length !== 32) throw new Error('SEED_SECRET_KEY must be 32 bytes, base64-encoded.');
      return k;
    }
    ensureDir(this.dir);
    const keyFile = join(this.dir, 'secret.key');
    if (!existsSync(keyFile)) writePrivateFile(keyFile, randomBytes(32).toString('base64'));
    const k = Buffer.from(readFileSync(keyFile, 'utf8').trim(), 'base64');
    if (k.length !== 32) throw new Error(`${keyFile} is not a valid key.`);
    return k;
  }

  private load(): Record<string, string> {
    if (this.cache) return this.cache;
    if (!existsSync(this.file)) return (this.cache = {});
    const env = JSON.parse(readFileSync(this.file, 'utf8')) as Envelope;
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(env.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]).toString('utf8');
    return (this.cache = JSON.parse(plain) as Record<string, string>);
  }

  private save(values: Record<string, string>) {
    ensureDir(this.dir);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(values), 'utf8'), cipher.final()]);
    const env: Envelope = { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
    writePrivateFile(this.file, JSON.stringify(env));
    this.cache = values;
  }

  get(name: string): string | undefined {
    return this.load()[name];
  }

  has(name: string): boolean {
    return Boolean(this.load()[name]);
  }

  set(name: string, value: string) {
    this.save({ ...this.load(), [name]: value });
  }

  delete(name: string) {
    const { [name]: _removed, ...rest } = this.load();
    this.save(rest);
  }

  /** Deletes every secret whose name starts with the prefix (e.g. all secrets of one agent). */
  deletePrefix(prefix: string) {
    this.save(Object.fromEntries(Object.entries(this.load()).filter(([k]) => !k.startsWith(prefix))));
  }

  masked(name: string): string | null {
    const v = this.get(name);
    return v ? maskSecret(v) : null;
  }
}

/** Shows at most the last 4 characters, and none for short values. */
export function maskSecret(value: string): string {
  return value.length >= 12 ? `••••${value.slice(-4)}` : '••••';
}
