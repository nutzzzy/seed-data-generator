import { describe, expect, it } from 'vitest';
import { defaultWorkspace, exampleStandard, exampleTemplate, seedDataStandard, seedDataTemplate } from './defaults';
import type { ColumnDef, Workspace } from './types';
import { loadWorkspace, saveWorkspace, STORAGE_KEY } from './storage';

describe('storage', () => {
  it('starts with example data when nothing is stored', () => {
    const { workspace, warning } = loadWorkspace(localStorage);
    expect(warning).toBeUndefined();
    expect(workspace.standards).toHaveLength(2);
    expect(workspace.templates[0].columns.length).toBeGreaterThan(0);
  });

  it('round-trips the whole workspace', () => {
    const ws = defaultWorkspace();
    ws.input = 'hello';
    ws.settings.provider = 'ollama';
    expect(saveWorkspace(ws, localStorage)).toBeNull();
    expect(loadWorkspace(localStorage).workspace).toEqual(ws);
  });

  it('keeps a backup of unreadable data instead of overwriting it silently', () => {
    localStorage.setItem(STORAGE_KEY, '{broken');
    const { workspace, warning } = loadWorkspace(localStorage);
    expect(warning).toMatch(/backup/);
    expect(workspace.standards).toHaveLength(2);
    const backupKey = Object.keys(localStorage).find((k) => k.startsWith(`${STORAGE_KEY}:backup-`));
    expect(backupKey && localStorage.getItem(backupKey)).toBe('{broken');
  });

  it('reports quota errors', () => {
    const full = { setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } } as unknown as Storage;
    expect(saveWorkspace(defaultWorkspace(), full)).toMatch(/full/);
  });
});

describe('built-in presets', () => {
  const oldWorkspace = () => {
    // Shape saved by the first version: no presets list, columns without "forbidden".
    const ws = defaultWorkspace() as Partial<Workspace>;
    ws.standards = [structuredClone(exampleStandard)];
    ws.templates = [{ ...structuredClone(exampleTemplate), columns: exampleTemplate.columns.map(({ forbidden: _f, ...c }) => c as ColumnDef) }];
    ws.standardDraft = structuredClone(exampleStandard);
    ws.templateDraft = structuredClone(ws.templates[0]);
    delete ws.presets;
    return ws;
  };

  it('adds the QA Seed Data preset to an older workspace without touching the current drafts', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldWorkspace()));
    const { workspace } = loadWorkspace(localStorage);
    expect(workspace.standards.map((s) => s.id)).toEqual([exampleStandard.id, seedDataStandard.id]);
    expect(workspace.templates.map((t) => t.id)).toEqual([exampleTemplate.id, seedDataTemplate.id]);
    expect(workspace.standardDraft.id).toBe(exampleStandard.id);
    expect(workspace.templates[0].columns.every((c) => c.forbidden === '')).toBe(true);
  });

  it('does not bring back a preset the user deleted', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldWorkspace()));
    const first = loadWorkspace(localStorage).workspace;
    saveWorkspace({ ...first, standards: first.standards.filter((s) => s.id !== seedDataStandard.id) }, localStorage);
    expect(loadWorkspace(localStorage).workspace.standards.map((s) => s.id)).toEqual([exampleStandard.id]);
  });
});
