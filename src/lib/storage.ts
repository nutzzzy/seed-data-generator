import { defaultSettings, defaultWorkspace, GUIDE_VERSION, presetStandards, presetTemplates, seedDataStandard, seedDataTemplate } from './defaults';
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
  if (!storage) return { workspace: fallback, warning: 'حافظهٔ مرورگر در دسترس نیست؛ کارها بعد از بستن این صفحه نگه داشته نمی‌شوند.' };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { workspace: fallback, warning: 'حافظهٔ مرورگر خوانده نشد.' };
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
    // A workspace saved with an older guide gets the current guide's preset content and uses it again, so tables are
    // never generated with an outdated or unrelated structure (e.g. Given/When/Then) left active from an older version.
    const outdated = parsed.guideVersion !== GUIDE_VERSION;
    const refresh = <T extends { id: string }>(list: T[], presets: T[]) =>
      outdated ? list.map((i) => structuredClone(presets.find((p) => p.id === i.id) ?? i)) : list;
    const standards = refresh(addPresets(parsed.standards, presetStandards), presetStandards);
    const templates = refresh(addPresets(parsed.templates, presetTemplates), presetTemplates).map(withColumns);
    const standardDraft = outdated ? structuredClone(seedDataStandard) : (parsed.standardDraft ?? fallback.standardDraft);
    const templateDraft = outdated ? structuredClone(seedDataTemplate) : (parsed.templateDraft ?? fallback.templateDraft);
    if (outdated) {
      if (!standards.some((i) => i.id === standardDraft.id)) standards.push(structuredClone(standardDraft));
      if (!templates.some((i) => i.id === templateDraft.id)) templates.push(structuredClone(templateDraft));
    }
    const table = parsed.table ?? null;
    return {
      workspace: {
        ...fallback,
        ...parsed,
        savedTables: Array.isArray(parsed.savedTables) ? parsed.savedTables : [],
        standards,
        templates,
        standardDraft,
        templateDraft: withColumns(templateDraft),
        input: typeof parsed.input === 'string' ? parsed.input : '',
        table: table && { ...table, columns: table.columns.map(normalizeColumn) },
        settings: { ...defaultSettings, ...parsed.settings },
        presets: fallback.presets,
        guideVersion: GUIDE_VERSION,
      },
    };
  } catch {
    // Never silently destroy unreadable data: keep a copy before starting fresh.
    try {
      storage.setItem(`${STORAGE_KEY}:backup-${Date.now()}`, raw);
    } catch {
      /* ignore */
    }
    return { workspace: fallback, warning: 'اطلاعات ذخیره‌شده خوانده نشد. یک نسخهٔ پشتیبان نگه داشته شد و برنامه با دادهٔ نمونه شروع شد.' };
  }
}

/** Returns an error message, or null on success. */
export function saveWorkspace(workspace: Workspace, storage: Storage | undefined = safeStorage()): string | null {
  if (!storage) return 'حافظهٔ مرورگر در دسترس نیست.';
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return null;
  } catch (err) {
    return err instanceof Error && err.name === 'QuotaExceededError'
      ? 'حافظهٔ مرورگر پر است. چند جدول ذخیره‌شده را حذف کنید.'
      : 'ذخیره در حافظهٔ مرورگر ناموفق بود.';
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
