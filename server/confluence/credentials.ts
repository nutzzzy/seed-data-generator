import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, SecretStore, writePrivateFile } from '../secretStore.ts';
import { ConfluenceError, type AuthType, type ConfluenceCredentials } from './api.ts';

const TOKEN = 'confluence:token';

interface StoredConfig {
  baseUrl: string;
  authType: AuthType;
  email?: string;
}

export interface ConfluenceStatusView {
  baseUrl: string;
  tokenSet: boolean;
  /** Where the active credentials come from: settings saved in the app, or .env.local. */
  source: 'app' | 'env' | null;
  authType: AuthType;
  email?: string;
  masked: string | null;
}

export interface ConfigInput {
  baseUrl?: unknown;
  authType?: unknown;
  email?: unknown;
  /** string = set, null = remove, missing = keep */
  token?: unknown;
}

export function cleanBaseUrl(value: unknown): string {
  let url: URL;
  try {
    url = new URL(typeof value === 'string' ? value.trim() : '');
  } catch {
    throw new ConfluenceError(400, 'آدرس Confluence معتبر نیست (مثلاً https://confluence.snappfood.ir).');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ConfluenceError(400, 'آدرس Confluence باید با https:// شروع شود.');
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * Confluence Authentication Service: credentials entered in the app (token encrypted in the SecretStore), falling back
 * to CONFLUENCE_BASE_URL / CONFLUENCE_TOKEN from .env.local so the existing setup keeps working.
 */
export class ConfluenceCredentialStore {
  private cache: StoredConfig | null | undefined;

  constructor(
    private readonly dir: string,
    private readonly secrets: SecretStore,
    private readonly env: { baseUrl: string; token?: string },
  ) {}

  private get file() {
    return join(this.dir, 'confluence.json');
  }

  private load(): StoredConfig | null {
    if (this.cache !== undefined) return this.cache;
    this.cache = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, 'utf8')) as StoredConfig) : null;
    return this.cache;
  }

  /** The credentials to use, or null when no token is configured anywhere. */
  resolve(): ConfluenceCredentials | null {
    const cfg = this.load();
    const token = this.secrets.get(TOKEN);
    if (cfg && token) return { baseUrl: cfg.baseUrl, authType: cfg.authType, email: cfg.email, token };
    if (this.env.token) return { baseUrl: this.env.baseUrl, authType: 'bearer', token: this.env.token };
    return null;
  }

  require(): ConfluenceCredentials {
    const creds = this.resolve();
    if (!creds) throw new ConfluenceError(401, 'توکن Confluence تنظیم نشده است. در تنظیمات Confluence آدرس و توکن را وارد کنید.');
    return creds;
  }

  status(): ConfluenceStatusView {
    const cfg = this.load();
    const appToken = this.secrets.masked(TOKEN);
    if (cfg && appToken) return { baseUrl: cfg.baseUrl, tokenSet: true, source: 'app', authType: cfg.authType, email: cfg.email, masked: appToken };
    if (this.env.token) return { baseUrl: this.env.baseUrl, tokenSet: true, source: 'env', authType: 'bearer', masked: '••••' };
    return { baseUrl: cfg?.baseUrl ?? this.env.baseUrl, tokenSet: false, source: null, authType: cfg?.authType ?? 'bearer', email: cfg?.email, masked: null };
  }

  /** Validates the form; a missing token falls back to the saved one so settings can change without re-entering it. */
  candidate(input: ConfigInput): ConfluenceCredentials {
    const baseUrl = cleanBaseUrl(input.baseUrl);
    const authType: AuthType = input.authType === 'basic' ? 'basic' : 'bearer';
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    if (authType === 'basic' && !email) throw new ConfluenceError(400, 'برای ورود با ایمیل و API Token، ایمیل را وارد کنید.');
    const given = typeof input.token === 'string' ? input.token.trim() : '';
    if (given && (/\s/.test(given) || given.length > 4096)) throw new ConfluenceError(400, 'توکن معتبر نیست.');
    const token = given || this.secrets.get(TOKEN) || '';
    if (!token) throw new ConfluenceError(400, 'توکن Confluence را وارد کنید.');
    return { baseUrl, authType, email: authType === 'basic' ? email : undefined, token };
  }

  save(input: ConfigInput): ConfluenceStatusView {
    const creds = this.candidate(input);
    ensureDir(this.dir);
    const cfg: StoredConfig = { baseUrl: creds.baseUrl, authType: creds.authType, ...(creds.email ? { email: creds.email } : {}) };
    writePrivateFile(this.file, JSON.stringify(cfg, null, 2));
    this.cache = cfg;
    this.secrets.set(TOKEN, creds.token);
    return this.status();
  }

  /** Removes the token saved in the app (the .env.local fallback, if any, stays). */
  remove(): ConfluenceStatusView {
    this.secrets.delete(TOKEN);
    return this.status();
  }
}
