import { defaultSettings, defaultWorkspace } from './defaults';
import type { Workspace } from './types';

export const STORAGE_KEY = 'local-table-generator:workspace:v1';

export interface LoadResult {
  workspace: Workspace;
  /** Set when stored data existed but could not be read; the broken data is kept under a backup key. */
  warning?: string;
}

export function loadWorkspace(storage: Storage | undefined = safeStorage()): LoadResult {
  const fallback = defaultWorkspace();
  if (!storage) return { workspace: fallback, warning: 'Browser storage is unavailable, so work will not be kept after closing this tab.' };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { workspace: fallback, warning: 'Browser storage could not be read.' };
  }
  if (!raw) return { workspace: fallback };
  try {
    const parsed = JSON.parse(raw) as Partial<Workspace>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.standards) || !Array.isArray(parsed.templates)) {
      throw new Error('Unexpected format');
    }
    return {
      workspace: {
        ...fallback,
        ...parsed,
        savedTables: Array.isArray(parsed.savedTables) ? parsed.savedTables : [],
        standardDraft: parsed.standardDraft ?? fallback.standardDraft,
        templateDraft: parsed.templateDraft ?? fallback.templateDraft,
        input: typeof parsed.input === 'string' ? parsed.input : '',
        table: parsed.table ?? null,
        settings: { ...defaultSettings, ...parsed.settings },
      },
    };
  } catch {
    // Never silently destroy unreadable data: keep a copy before starting fresh.
    try {
      storage.setItem(`${STORAGE_KEY}:backup-${Date.now()}`, raw);
    } catch {
      /* ignore */
    }
    return { workspace: fallback, warning: 'Saved data could not be read. A backup copy was kept and the app started with example data.' };
  }
}

/** Returns an error message, or null on success. */
export function saveWorkspace(workspace: Workspace, storage: Storage | undefined = safeStorage()): string | null {
  if (!storage) return 'Browser storage is unavailable.';
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return null;
  } catch (err) {
    return err instanceof Error && err.name === 'QuotaExceededError'
      ? 'Browser storage is full. Delete some saved tables to keep saving.'
      : 'Could not save to browser storage.';
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}
