import { defaultSettings, defaultWorkspace, presetStandards, presetTemplates } from './defaults';
import { blankColumn } from './model';
import type { ColumnDef, Template, Workspace } from './types';

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
    // Workspaces from older versions get new built-in presets once (never again after the user deletes one).
    const known = new Set(Array.isArray(parsed.presets) ? parsed.presets : []);
    const addPresets = <T extends { id: string }>(list: T[], presets: T[]) => [
      ...list,
      ...presets.filter((p) => !known.has(p.id) && !list.some((i) => i.id === p.id)).map((p) => structuredClone(p)),
    ];
    const withColumns = (t: Template): Template => ({ ...t, columns: t.columns.map(normalizeColumn) });
    const standardDraft = parsed.standardDraft ?? fallback.standardDraft;
    const templateDraft = parsed.templateDraft ?? fallback.templateDraft;
    const table = parsed.table ?? null;
    return {
      workspace: {
        ...fallback,
        ...parsed,
        savedTables: Array.isArray(parsed.savedTables) ? parsed.savedTables : [],
        standards: addPresets(parsed.standards, presetStandards),
        templates: addPresets(parsed.templates, presetTemplates).map(withColumns),
        standardDraft,
        templateDraft: withColumns(templateDraft),
        input: typeof parsed.input === 'string' ? parsed.input : '',
        table: table && { ...table, columns: table.columns.map(normalizeColumn) },
        settings: { ...defaultSettings, ...parsed.settings },
        presets: fallback.presets,
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

/** Fills in column fields added by newer versions. */
function normalizeColumn(c: ColumnDef): ColumnDef {
  return { ...blankColumn(), ...c };
}
