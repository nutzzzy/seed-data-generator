import { describe, expect, it } from 'vitest';
import { exampleStandard, exampleTemplate } from '../test/fixtures';
import { defaultWorkspace, GUIDE_VERSION, seedDataStandard, seedDataTemplate } from './defaults';
import type { ColumnDef, Workspace } from './types';
import { loadWorkspace, saveWorkspace, STORAGE_KEY } from './storage';

describe('storage', () => {
  it('starts with example data when nothing is stored', () => {
    const { workspace, warning } = loadWorkspace(localStorage);
    expect(warning).toBeUndefined();
    expect(workspace.standards.map((s) => s.id)).toEqual([seedDataStandard.id]);
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
    expect(warning).toMatch(/پشتیبان/);
    expect(workspace.standards.map((s) => s.id)).toEqual([seedDataStandard.id]);
    const backupKey = Object.keys(localStorage).find((k) => k.startsWith(`${STORAGE_KEY}:backup-`));
    expect(backupKey && localStorage.getItem(backupKey)).toBe('{broken');
  });

  it('reports quota errors', () => {
    const full = { setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } } as unknown as Storage;
    expect(saveWorkspace(defaultWorkspace(), full)).toMatch(/پر است/);
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
    delete ws.guideVersion;
    return ws;
  };

  it('adds the QA Seed Data preset to an older workspace and makes the guide active again', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldWorkspace()));
    const { workspace } = loadWorkspace(localStorage);
    expect(workspace.standards.map((s) => s.id)).toEqual([exampleStandard.id, seedDataStandard.id]);
    expect(workspace.templates.map((t) => t.id)).toEqual([exampleTemplate.id, seedDataTemplate.id]);
    expect(workspace.standardDraft).toEqual(seedDataStandard);
    expect(workspace.templateDraft).toEqual(seedDataTemplate);
    expect(workspace.guideVersion).toBe(GUIDE_VERSION);
    expect(workspace.templates[0].columns.every((c) => c.forbidden === '')).toBe(true);
  });

  it('updates the preset content of a workspace saved with an older guide, keeping the user\'s own items', () => {
    const ws = oldWorkspace();
    ws.presets = [seedDataStandard.id, seedDataTemplate.id];
    ws.standards!.push({ ...structuredClone(seedDataStandard), rules: 'old rules' });
    ws.templates!.push({ ...structuredClone(seedDataTemplate), columns: seedDataTemplate.columns.slice(0, 2) });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
    const { workspace } = loadWorkspace(localStorage);
    expect(workspace.standards).toEqual([exampleStandard, seedDataStandard]);
    expect(workspace.templates[1]).toEqual(seedDataTemplate);
    expect(workspace.templateDraft.id).toBe(seedDataTemplate.id);
  });

  it('keeps the user\'s choice of structure once the workspace has the current guide', () => {
    const ws = { ...oldWorkspace(), presets: [seedDataStandard.id, seedDataTemplate.id], guideVersion: GUIDE_VERSION };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
    expect(loadWorkspace(localStorage).workspace.templateDraft.id).toBe(exampleTemplate.id);
  });

  it('does not bring back a preset the user deleted', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(oldWorkspace()));
    const first = loadWorkspace(localStorage).workspace;
    saveWorkspace({ ...first, standards: first.standards.filter((s) => s.id !== seedDataStandard.id) }, localStorage);
    expect(loadWorkspace(localStorage).workspace.standards.map((s) => s.id)).toEqual([exampleStandard.id]);
  });
});
