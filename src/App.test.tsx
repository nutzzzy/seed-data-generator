import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DialogProvider } from './components/Dialogs';
import { ToastProvider } from './components/Toasts';
import { defaultWorkspace, exampleTemplate } from './lib/defaults';
import type { AiTransport } from './lib/generate';
import { STORAGE_KEY } from './lib/storage';
import type { Workspace } from './lib/types';

function renderApp(transport?: AiTransport) {
  const user = userEvent.setup();
  const utils = render(
    <ToastProvider>
      <DialogProvider>
        <App transport={transport} />
      </DialogProvider>
    </ToastProvider>,
  );
  return { user, ...utils };
}

const stored = (): Workspace => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
const waitForSave = (check: (w: Workspace) => boolean) => waitFor(() => expect(check(stored())).toBe(true));
const useAi = () => {
  const ws = defaultWorkspace();
  ws.settings.provider = 'anthropic';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
};
const dialog = () => screen.getByRole('dialog');
const headerNames = () => screen.getAllByRole('textbox', { name: /^Column \d+ header$/ }).map((i) => (i as HTMLInputElement).value);
const templateNames = () => screen.getAllByRole('textbox', { name: /^Column \d+ name$/ }).map((i) => (i as HTMLInputElement).value);

beforeEach(() => {
  const ws = defaultWorkspace();
  ws.settings.provider = 'basic';
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
});
afterEach(() => vi.restoreAllMocks());

describe('standards', () => {
  it('edits, saves and reloads a standard', async () => {
    const { user, unmount } = renderApp();
    const name = screen.getByLabelText('Standard name');
    await user.clear(name);
    await user.type(name, 'API docs standard');
    expect(screen.getAllByText(/Unsaved changes/)).toHaveLength(1);
    const standardCard = screen.getByRole('region', { name: 'Standard' });
    await user.click(within(standardCard).getByRole('button', { name: 'Save' }));
    expect(within(standardCard).getByRole('button', { name: 'Saved' })).toBeDisabled();
    await waitForSave((w) => w.standards[0].name === 'API docs standard');

    unmount();
    renderApp();
    expect(screen.getByLabelText('Standard name')).toHaveValue('API docs standard');
    expect(screen.getByRole('combobox', { name: 'Saved standards' })).toHaveDisplayValue('API docs standard');
  });

  it('duplicates, renames and deletes with confirmation', async () => {
    const { user } = renderApp();
    const card = screen.getByRole('region', { name: 'Standard' });
    await user.click(within(card).getByRole('button', { name: 'Duplicate' }));
    expect(within(card).getAllByRole('option')).toHaveLength(2);

    await user.click(within(card).getByRole('button', { name: 'Rename' }));
    const input = within(dialog()).getByLabelText('New name');
    await user.clear(input);
    await user.type(input, 'Copy B{Enter}');
    expect(screen.getByLabelText('Standard name')).toHaveValue('Copy B');

    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    expect(dialog()).toHaveTextContent('“Copy B” will be permanently deleted.');
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect(within(card).getAllByRole('option')).toHaveLength(2);

    await user.click(within(card).getByRole('button', { name: 'Delete' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Delete' }));
    expect(within(card).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByLabelText('Standard name')).toHaveValue('Acceptance criteria (Given/When/Then)');
  });

  it('asks before discarding unsaved changes when switching to a new standard', async () => {
    const { user } = renderApp();
    await user.type(screen.getByLabelText(/^Rules and constraints/), '\nExtra rule');
    const card = screen.getByRole('region', { name: 'Standard' });
    await user.click(within(card).getByRole('button', { name: 'New' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText(/^Rules and constraints/) as HTMLTextAreaElement).value).toContain('Extra rule');
    await user.click(within(card).getByRole('button', { name: 'New' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Discard changes' }));
    expect(screen.getByLabelText('Standard name')).toHaveValue('Untitled standard');
  });
});

describe('table structure', () => {
  it('adds, renames, reorders and removes columns', async () => {
    const { user } = renderApp();
    expect(templateNames()).toEqual(exampleTemplate.columns.map((c) => c.name));
    await user.click(screen.getByRole('button', { name: '+ Add column' }));
    const added = screen.getByRole('textbox', { name: 'Column 7 name' });
    await user.clear(added);
    await user.type(added, 'Owner');
    await user.click(screen.getByRole('button', { name: 'Move Owner up' }));
    expect(templateNames().slice(-2)).toEqual(['Owner', 'Priority']);
    await user.click(screen.getByRole('button', { name: 'Remove ID' }));
    expect(templateNames()).toEqual(['Scenario', 'Given', 'When', 'Then', 'Owner', 'Priority']);
    const card = screen.getByRole('region', { name: 'Table structure' });
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    await waitForSave((w) => w.templates[0].columns.map((c) => c.name).join() === 'Scenario,Given,When,Then,Owner,Priority');
  });
});

describe('generation', () => {
  it('generates offline, keeps the exact columns, allows editing and validates', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Generate table' }));
    expect(await screen.findByText(/Generated 5 rows/)).toBeInTheDocument();
    expect(headerNames()).toEqual(exampleTemplate.columns.map((c) => c.name));

    // Required ID is not in the input -> flagged as Not specified, never invented.
    expect(screen.getByRole('textbox', { name: 'Row 1, ID' })).toHaveValue('Not specified');
    const cell = screen.getByRole('textbox', { name: 'Row 2, ID' });
    await user.clear(cell);
    await user.type(cell, 'AC-1');
    await waitForSave((w) => Object.values(w.table!.rows[1].cells).includes('AC-1'));

    await user.click(screen.getByRole('button', { name: 'Validate' }));
    const panel = screen.getByRole('region', { name: 'Validation results' });
    expect(panel).toHaveTextContent('Row 1: "ID" is marked Not specified — needs review.');
    expect(panel).toHaveTextContent('Check manually against the standard');

    // Editing the table's columns must not change the template.
    const header = screen.getByRole('textbox', { name: 'Column 1 header' });
    await user.clear(header);
    await user.type(header, 'Key');
    expect(templateNames()[0]).toBe('ID');
    expect(panel).toHaveTextContent('Unexpected column "Key"');
  });

  it('shows an error for empty input without calling the AI', async () => {
    useAi();
    const transport = vi.fn<AiTransport>();
    const { user } = renderApp(transport);
    await user.clear(screen.getByLabelText('Input text'));
    await user.click(screen.getByRole('button', { name: 'Generate table' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add some input text first');
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps the input and the existing table when the AI fails or answers with malformed data', async () => {
    useAi();
    const names = exampleTemplate.columns.map((c) => c.name);
    const transport = vi
      .fn<AiTransport>()
      .mockResolvedValueOnce(JSON.stringify({ rows: [Object.fromEntries(names.map((n) => [n, `${n}-1`]))], issues: [] }))
      .mockResolvedValueOnce('I could not do that')
      .mockRejectedValueOnce(new Error('network down'));
    const { user } = renderApp(transport);
    await user.click(screen.getByRole('button', { name: 'Generate table' }));
    expect(await screen.findByRole('textbox', { name: 'Row 1, Scenario' })).toHaveValue('Scenario-1');
    const input = (screen.getByLabelText('Input text') as HTMLTextAreaElement).value;

    for (const expected of ['not valid JSON', 'network down']) {
      await user.click(screen.getByRole('button', { name: 'Regenerate' }));
      await user.click(within(dialog()).getByRole('button', { name: 'Generate new table' }));
      await waitFor(() => expect(screen.getByText(new RegExp(expected))).toBeInTheDocument());
      expect(screen.getByText(/Your input and current table were not changed/)).toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Row 1, Scenario' })).toHaveValue('Scenario-1');
      expect(screen.getByLabelText('Input text')).toHaveValue(input);
    }
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('updates the template from the table only after confirmation', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Generate table' }));
    await screen.findByText(/Generated 5 rows/);
    await user.click(screen.getByRole('button', { name: 'Remove column Priority' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Remove column' }));
    expect(templateNames()).toContain('Priority');
    await user.click(screen.getByRole('button', { name: 'Update template from table' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Update template' }));
    expect(templateNames()).not.toContain('Priority');
    await waitForSave((w) => w.templates[0].columns.length === 5);
  });

  it('saves a table and opens it again after a restart', async () => {
    const { user, unmount } = renderApp();
    await user.click(screen.getByRole('button', { name: 'Generate table' }));
    await screen.findByText(/Generated 5 rows/);
    await user.click(screen.getByRole('button', { name: 'Save table' }));
    const name = within(dialog()).getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Sprint 12{Enter}');
    await user.click(screen.getByRole('button', { name: 'Clear table' }));
    await user.click(within(dialog()).getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No table yet.')).toBeInTheDocument();
    await waitForSave((w) => w.table === null && w.savedTables.length === 1);

    unmount();
    const again = renderApp();
    await again.user.click(screen.getByText('Saved tables (1)'));
    await again.user.click(screen.getByRole('button', { name: 'Open' }));
    expect(screen.getAllByRole('textbox', { name: /^Row \d+, ID$/ })).toHaveLength(5);
  });
});

describe('export', () => {
  async function generated() {
    const r = renderApp();
    await r.user.click(screen.getByRole('button', { name: 'Generate table' }));
    await screen.findByText(/Generated 5 rows/);
    return r;
  }

  it('copies a rich HTML table plus plain-text fallback for Confluence', async () => {
    const { user } = await generated();
    const items: Record<string, Blob>[] = [];
    class FakeClipboardItem {
      constructor(readonly data: Record<string, Blob>) {
        items.push(data);
      }
    }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    const write = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(navigator.clipboard, 'write').mockImplementation(write);

    await user.click(screen.getByRole('button', { name: /Copy for Confluence/ }));
    expect(await screen.findByText('Table copied to the clipboard.')).toBeInTheDocument();
    const html = await items[0]['text/html'].text();
    expect(html).toMatch(/^<table>\n {2}<thead>\n {4}<tr><th>ID<\/th><th>Scenario<\/th><th>Given<\/th><th>When<\/th><th>Then<\/th><th>Priority<\/th><\/tr>/);
    expect(html).toContain("<td>If the email is not registered, show the same confirmation message so accounts can&#39;t be discovered.</td>");
    expect(await items[0]['text/plain'].text()).toMatch(/^ID\tScenario\tGiven/);
    vi.unstubAllGlobals();
  });

  it('copies HTML source and shows the text for manual copying when the clipboard is blocked', async () => {
    const { user } = await generated();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    document.execCommand = vi.fn().mockReturnValue(false);
    await user.click(screen.getByRole('button', { name: /Copy as HTML/ }));
    const box = within(dialog()).getByRole('textbox') as HTMLTextAreaElement;
    expect(box.value.startsWith('<table>')).toBe(true);
  });

  it('downloads a UTF-8 CSV file', async () => {
    const { user } = await generated();
    let blob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blob = b as Blob;
      return 'blob:x';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await user.click(screen.getByRole('button', { name: /Download CSV/ }));
    expect(click).toHaveBeenCalled();
    expect(blob!.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = new TextDecoder().decode(bytes.slice(3));
    expect(text.split('\r\n')[0]).toBe('ID,Scenario,Given,When,Then,Priority');
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(6);
  });
});
