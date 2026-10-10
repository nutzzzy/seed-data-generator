import { describe, expect, it } from 'vitest';
import { defaultWorkspace } from './defaults';
import { loadWorkspace, saveWorkspace, STORAGE_KEY } from './storage';

describe('storage', () => {
  it('starts with example data when nothing is stored', () => {
    const { workspace, warning } = loadWorkspace(localStorage);
    expect(warning).toBeUndefined();
    expect(workspace.standards).toHaveLength(1);
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
    expect(workspace.standards).toHaveLength(1);
    const backupKey = Object.keys(localStorage).find((k) => k.startsWith(`${STORAGE_KEY}:backup-`));
    expect(backupKey && localStorage.getItem(backupKey)).toBe('{broken');
  });

  it('reports quota errors', () => {
    const full = { setItem: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); } } as unknown as Storage;
    expect(saveWorkspace(defaultWorkspace(), full)).toMatch(/full/);
  });
});
