import { defaultSettings } from '../lib/defaults';
import { defaultUcWorkspace } from './model';
import type { UcWorkspace } from './types';

/** Separate from the Seed Data workspace: the two sections never share stored data. */
export const UC_STORAGE_KEY = 'snapp-usecase:workspace:v1';

export function loadUcWorkspace(storage: Storage | undefined = safeStorage()): { workspace: UcWorkspace; warning?: string } {
  const fallback = defaultUcWorkspace();
  if (!storage) return { workspace: fallback, warning: 'حافظهٔ مرورگر در دسترس نیست؛ کارها بعد از بستن این صفحه نگه داشته نمی‌شوند.' };
  let raw: string | null = null;
  try {
    raw = storage.getItem(UC_STORAGE_KEY);
    if (!raw) return { workspace: fallback };
    const parsed = JSON.parse(raw) as Partial<UcWorkspace>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.docs)) throw new Error('Unexpected format');
    const docs = parsed.docs;
    return {
      workspace: {
        ...fallback,
        ...parsed,
        docs,
        activeId: docs.some((d) => d.id === parsed.activeId) ? parsed.activeId! : (docs[0]?.id ?? null),
        input: typeof parsed.input === 'string' ? parsed.input : '',
        settings: { ...defaultSettings, ...parsed.settings },
      },
    };
  } catch {
    try {
      if (raw) storage.setItem(`${UC_STORAGE_KEY}:backup-${Date.now()}`, raw);
    } catch {
      /* ignore */
    }
    return { workspace: fallback, warning: 'اسناد Use Case ذخیره‌شده خوانده نشدند. یک نسخهٔ پشتیبان نگه داشته شد.' };
  }
}

export function saveUcWorkspace(workspace: UcWorkspace, storage: Storage | undefined = safeStorage()): string | null {
  if (!storage) return 'حافظهٔ مرورگر در دسترس نیست.';
  try {
    storage.setItem(UC_STORAGE_KEY, JSON.stringify(workspace));
    return null;
  } catch (err) {
    return err instanceof Error && err.name === 'QuotaExceededError' ? 'حافظهٔ مرورگر پر است. چند سند را حذف کنید.' : 'ذخیره در حافظهٔ مرورگر ناموفق بود.';
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
