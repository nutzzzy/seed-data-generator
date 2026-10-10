import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { DialogProvider } from './components/Dialogs';
import { ToastProvider } from './components/Toasts';
import { defaultWorkspace, seedDataTemplate } from './lib/defaults';
import type { AiTransport } from './lib/generate';
import { STORAGE_KEY } from './lib/storage';
import type { Workspace } from './lib/types';
import { exampleStandard, exampleTemplate } from './test/fixtures';

function renderApp(transport: AiTransport = aiReturning()) {
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

const COLUMNS = seedDataTemplate.columns.map((c) => c.name);
const vendor = {
  'Seed Data ID': 'SD-VENDOR-ACTIVE-001',
  Name: 'Active Vendor',
  Purpose: 'برای تست سناریوهایی که نیاز به یک Vendor فعال دارند.',
  Environment: 'UAT',
  Data: 'Vendor ID: 100977\nVendor Name: QA Vendor 01\nStatus: Active',
  Preconditions: 'Vendor must be Active.',
  'How to Create': 'Not specified',
  'Used For': 'Vendor Login, Order Management',
};
const order = {
  ...vendor,
  'Seed Data ID': 'SD-ORDER-PENDING-001',
  Name: 'Pending Order - Active Vendor',
  Data: 'Vendor ID: 100977\nOrder Status: Pending',
  'How to Create': '1. Create an order.\n2. Leave it pending.',
};
/** A stand-in for Claude Code that answers like the real provider. */
function aiReturning(rows: object[] = [vendor, order], issues: object[] = []) {
  return vi.fn<AiTransport>().mockResolvedValue(JSON.stringify({ rows, issues }));
}

const stored = (): Workspace => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
const waitForSave = (check: (w: Workspace) => boolean) => waitFor(() => expect(check(stored())).toBe(true));
const dialog = () => screen.getByRole('dialog');
const headerNames = () => screen.getAllByRole('textbox', { name: /^عنوان ستون \d+$/ }).map((i) => (i as HTMLInputElement).value);
const templateNames = () => screen.getAllByRole('textbox', { name: /^نام ستون \d+$/ }).map((i) => (i as HTMLInputElement).value);
const cell = (row: number, column: string) => screen.getByRole('textbox', { name: `ردیف ${row}، ${column}` });

async function generated(transport?: AiTransport) {
  const r = renderApp(transport);
  await r.user.click(screen.getByRole('button', { name: 'ساخت Seed Data' }));
  await screen.findByText(/2 Seed Data ساخته شد/);
  return r;
}
async function openAdvanced(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('تنظیمات پیشرفته: استاندارد و ساختار جدول'));
}

beforeEach(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultWorkspace())));
afterEach(() => vi.restoreAllMocks());

describe('workspace', () => {
  it('starts with the Seed Data guide, the QA Seed Data standard and template, and example notes', async () => {
    localStorage.clear();
    const { user } = renderApp();
    expect(screen.getByRole('heading', { name: 'تولید Seed Data برای QA' })).toBeInTheDocument();
    expect(screen.getByText('راهنمای Seed Data')).toBeInTheDocument();
    expect(screen.getByText('SD-[ENTITY]-[DESCRIPTION]-[NUMBER]')).toBeInTheDocument();
    expect((screen.getByLabelText('متن ورودی') as HTMLTextAreaElement).value).toContain('Food Partner');
    expect(screen.getByRole('button', { name: /Claude Code · تنظیمات/ })).toBeInTheDocument();
    await openAdvanced(user);
    expect(screen.getByLabelText('نام استاندارد')).toHaveValue('QA Seed Data (Confluence)');
    expect(templateNames()).toEqual(COLUMNS);
  });

  it('does not generate with a structure that does not follow the Seed Data guide', async () => {
    const ws = defaultWorkspace();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...ws, standardDraft: exampleStandard, templateDraft: exampleTemplate, standards: [...ws.standards, exampleStandard], templates: [...ws.templates, exampleTemplate] }));
    const transport = aiReturning();
    const { user } = renderApp(transport);
    expect(screen.getByText(/طبق راهنمای Seed Data نیست و این ستون‌ها را ندارد: Seed Data ID/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ساخت Seed Data' }));
    expect(transport).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'استفاده از ساختار راهنمای QA Seed Data' }));
    await user.click(screen.getByRole('button', { name: 'ساخت Seed Data' }));
    await screen.findByText(/2 Seed Data ساخته شد/);
    expect(headerNames()).toEqual(COLUMNS);
  });
});

describe('theme', () => {
  afterEach(() => delete document.documentElement.dataset.theme);

  it('switches between light, dark and system from the top of the page and remembers the choice', async () => {
    const { user, unmount } = renderApp();
    const group = screen.getByRole('group', { name: 'تم' });
    expect(within(group).getByRole('button', { name: 'خودکار' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(group).getByRole('button', { name: '☾ تیره' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem('local-table-generator:theme')).toBe('dark');

    unmount();
    renderApp();
    expect(within(screen.getByRole('group', { name: 'تم' })).getByRole('button', { name: '☾ تیره' })).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(screen.getByRole('button', { name: '☀ روشن' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: 'خودکار' }));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem('local-table-generator:theme')).toBeNull();
  });
});

describe('generation', () => {
  it('generates Seed Data with exactly the template columns and scores the guide checklist', async () => {
    const transport = aiReturning([vendor, order], [{ row: 0, column: '', message: 'Customer ID 1258 فقط در یک Test Case استفاده می‌شود؛ در Zephyr بماند.' }]);
    const { user } = await generated(transport);
    expect(headerNames()).toEqual(COLUMNS);
    expect(cell(1, 'Seed Data ID')).toHaveValue('SD-VENDOR-ACTIVE-001');

    const req = transport.mock.calls[0][0];
    expect(req.provider).toBe('claude-code');
    expect(req.user).toContain('SD-[ENTITY]-[DESCRIPTION]-[NUMBER]');
    expect(req.user).toContain('Food Partner');

    const panel = screen.getByRole('region', { name: 'نتیجهٔ بررسی' });
    expect(panel).toHaveTextContent('خطایی پیدا نشد');
    expect(panel).toHaveTextContent('در Zephyr بماند');
    const howTo = within(panel).getByText(/نحوهٔ ایجاد در صورت نیاز/).closest('li')!;
    expect(howTo).toHaveClass('state-review');
    expect(howTo).toHaveTextContent('ردیف 1');

    // Editing a cell re-checks the table immediately.
    await user.clear(cell(2, 'Environment'));
    await user.type(cell(2, 'Environment'), 'dev');
    const env = within(panel).getByText(/Environment مشخص و مجاز است/).closest('li')!;
    expect(env).toHaveClass('state-fail');
    expect(env).toHaveTextContent('ردیف 2');
    await user.click(screen.getByRole('button', { name: 'بررسی با Checklist' }));
    expect(await screen.findByText('1 خطا پیدا شد.')).toBeInTheDocument();
    await waitForSave((w) => Object.values(w.table!.rows[1].cells).includes('dev'));
  });

  it('works offline without AI and marks missing information as Not specified', async () => {
    const ws = defaultWorkspace();
    ws.settings.provider = 'basic';
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
    const transport = vi.fn<AiTransport>();
    const { user } = renderApp(transport);
    await user.click(screen.getByRole('button', { name: 'ساخت Seed Data' }));
    expect(await screen.findByText(/Seed Data ساخته شد/)).toBeInTheDocument();
    expect(transport).not.toHaveBeenCalled();
    expect(headerNames()).toEqual(COLUMNS);
    expect(cell(1, 'Seed Data ID')).toHaveValue('Not specified');
    expect((cell(1, 'Name') as HTMLTextAreaElement).value).toContain('Food Partner');
  });

  it('shows an error for empty input without calling the AI', async () => {
    const transport = vi.fn<AiTransport>();
    const { user } = renderApp(transport);
    await user.clear(screen.getByLabelText('متن ورودی'));
    await user.click(screen.getByRole('button', { name: 'ساخت Seed Data' }));
    expect(screen.getByRole('alert')).toHaveTextContent('ابتدا نیازمندی‌ها یا یادداشت‌ها را وارد کنید');
    expect(transport).not.toHaveBeenCalled();
  });

  it('keeps the input and the existing table when the AI fails or answers with malformed data', async () => {
    const transport = vi
      .fn<AiTransport>()
      .mockResolvedValueOnce(JSON.stringify({ rows: [vendor, order], issues: [] }))
      .mockResolvedValueOnce('I could not do that')
      .mockRejectedValueOnce(new Error('network down'));
    const { user } = await generated(transport);
    const input = (screen.getByLabelText('متن ورودی') as HTMLTextAreaElement).value;

    for (const expected of ['JSON معتبر نبود', 'network down']) {
      await user.click(screen.getByRole('button', { name: 'ساخت دوباره' }));
      await user.click(within(dialog()).getByRole('button', { name: 'ساخت دوباره' }));
      await waitFor(() => expect(screen.getByText(new RegExp(expected))).toBeInTheDocument());
      expect(screen.getByText(/ورودی و جدول فعلی شما تغییری نکرد/)).toBeInTheDocument();
      expect(cell(1, 'Seed Data ID')).toHaveValue('SD-VENDOR-ACTIVE-001');
      expect(screen.getByLabelText('متن ورودی')).toHaveValue(input);
    }
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('saves Seed Data and opens it again after a restart', async () => {
    const { user, unmount } = await generated();
    await user.click(screen.getByRole('button', { name: 'ذخیره' }));
    const name = within(dialog()).getByLabelText('نام');
    await user.clear(name);
    await user.type(name, 'Food Partner UAT{Enter}');
    await user.click(screen.getByRole('button', { name: 'پاک کردن جدول' }));
    await user.click(within(dialog()).getByRole('button', { name: 'پاک کردن' }));
    expect(screen.getByText('هنوز Seed Dataای ساخته نشده است.')).toBeInTheDocument();
    await waitForSave((w) => w.table === null && w.savedTables.length === 1);

    unmount();
    const again = renderApp();
    await again.user.click(screen.getByText('Seed Dataهای ذخیره‌شده (1)'));
    await again.user.click(screen.getByRole('button', { name: 'باز کردن' }));
    expect(cell(2, 'Seed Data ID')).toHaveValue('SD-ORDER-PENDING-001');
  });

  it('changes the template from the table only after confirmation; table edits alone never change it', async () => {
    const { user } = await generated();
    await user.click(screen.getByRole('button', { name: 'حذف ستون Used For' }));
    await user.click(within(dialog()).getByRole('button', { name: 'حذف ستون' }));
    await openAdvanced(user);
    expect(templateNames()).toContain('Used For');
    await user.click(screen.getByRole('button', { name: 'به‌روزرسانی ساختار از روی جدول فعلی' }));
    await user.click(within(dialog()).getByRole('button', { name: 'به‌روزرسانی ساختار' }));
    expect(templateNames()).not.toContain('Used For');
    await waitForSave((w) => w.templates[0].columns.length === COLUMNS.length - 1);
  });
});

describe('standard and table structure (advanced)', () => {
  it('edits, saves and reloads the standard', async () => {
    const { user, unmount } = renderApp();
    await openAdvanced(user);
    const name = screen.getByLabelText('نام استاندارد');
    await user.clear(name);
    await user.type(name, 'QA Seed Data v2');
    expect(screen.getAllByText(/تغییرات ذخیره نشده‌اند/)).toHaveLength(1);
    const card = screen.getByRole('region', { name: 'استاندارد' });
    await user.click(within(card).getByRole('button', { name: 'ذخیره' }));
    expect(within(card).getByRole('button', { name: 'ذخیره شده' })).toBeDisabled();
    await waitForSave((w) => w.standards[0].name === 'QA Seed Data v2');

    unmount();
    renderApp();
    expect(screen.getByLabelText('نام استاندارد')).toHaveValue('QA Seed Data v2');
    expect(screen.getByRole('combobox', { name: 'استانداردهای ذخیره‌شده' })).toHaveDisplayValue('QA Seed Data v2');
  });

  it('duplicates, renames and deletes with confirmation', async () => {
    const { user } = renderApp();
    await openAdvanced(user);
    const card = screen.getByRole('region', { name: 'استاندارد' });
    await user.click(within(card).getByRole('button', { name: 'کپی' }));
    expect(within(card).getAllByRole('option')).toHaveLength(2);

    await user.click(within(card).getByRole('button', { name: 'تغییر نام' }));
    const input = within(dialog()).getByLabelText('نام جدید');
    await user.clear(input);
    await user.type(input, 'Copy B{Enter}');
    expect(screen.getByLabelText('نام استاندارد')).toHaveValue('Copy B');

    await user.click(within(card).getByRole('button', { name: 'حذف' }));
    expect(dialog()).toHaveTextContent('«Copy B» برای همیشه حذف می‌شود.');
    await user.click(within(dialog()).getByRole('button', { name: 'انصراف' }));
    expect(within(card).getAllByRole('option')).toHaveLength(2);

    await user.click(within(card).getByRole('button', { name: 'حذف' }));
    await user.click(within(dialog()).getByRole('button', { name: 'حذف' }));
    expect(within(card).getAllByRole('option')).toHaveLength(1);
    expect(screen.getByLabelText('نام استاندارد')).toHaveValue('QA Seed Data (Confluence)');
  });

  it('asks before discarding unsaved changes when creating a new standard', async () => {
    const { user } = renderApp();
    await openAdvanced(user);
    await user.type(screen.getByLabelText(/^قوانین و محدودیت‌ها/), '\nExtra rule');
    const card = screen.getByRole('region', { name: 'استاندارد' });
    await user.click(within(card).getByRole('button', { name: 'جدید' }));
    await user.click(within(dialog()).getByRole('button', { name: 'انصراف' }));
    expect((screen.getByLabelText(/^قوانین و محدودیت‌ها/) as HTMLTextAreaElement).value).toContain('Extra rule');
    await user.click(within(card).getByRole('button', { name: 'جدید' }));
    await user.click(within(dialog()).getByRole('button', { name: 'حذف تغییرات' }));
    expect(screen.getByLabelText('نام استاندارد')).toHaveValue('استاندارد جدید');
  });

  it('adds, renames, reorders and removes columns', async () => {
    const { user } = renderApp();
    await openAdvanced(user);
    await user.click(screen.getByRole('button', { name: '+ افزودن ستون' }));
    const added = screen.getByRole('textbox', { name: `نام ستون ${COLUMNS.length + 1}` });
    await user.clear(added);
    await user.type(added, 'Owner');
    await user.click(screen.getByRole('button', { name: 'انتقال Owner به بالا' }));
    expect(templateNames().slice(-2)).toEqual(['Owner', 'Used For']);
    await user.click(screen.getByRole('button', { name: 'حذف Owner' }));
    expect(templateNames()).toEqual(COLUMNS);
  });
});

describe('Confluence and Zephyr', () => {
  function captureClipboard() {
    const items: Record<string, Blob>[] = [];
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(data: Record<string, Blob>) {
          items.push(data);
        }
      },
    );
    vi.spyOn(navigator.clipboard, 'write').mockResolvedValue(undefined);
    return items;
  }
  afterEach(() => vi.unstubAllGlobals());

  it('copies one section per Seed Data in the guide structure, with a plain-text fallback', async () => {
    const { user } = await generated();
    const items = captureClipboard();
    await user.click(screen.getByRole('button', { name: /کپی برای Confluence — هر Seed Data جدا/ }));
    expect(await screen.findByText('Seed Dataها برای Confluence کپی شد.')).toBeInTheDocument();
    const html = await items[0]['text/html'].text();
    expect(html).toMatch(/^<h3>SD-VENDOR-ACTIVE-001<\/h3>\n<h4>Name<\/h4>/);
    expect(html).toContain('<h4>Data</h4>\n<table><tbody><tr><th>Vendor ID</th><td dir="auto">100977</td></tr>');
    expect(html).toContain('<h3>SD-ORDER-PENDING-001</h3>');
    expect(await items[0]['text/plain'].text()).toMatch(/^SD-VENDOR-ACTIVE-001\nName: Active Vendor/);
  });

  it('copies all Seed Data as one table with the template columns in order', async () => {
    const { user } = await generated();
    const items = captureClipboard();
    await user.click(screen.getByRole('button', { name: /کپی برای Confluence — یک جدول/ }));
    const html = await items[0]['text/html'].text();
    expect(html).toContain(`<tr>${COLUMNS.map((c) => `<th>${c}</th>`).join('')}</tr>`);
  });

  it('shows and copies the Zephyr reference instead of the full data', async () => {
    const { user } = await generated();
    const exportSection = screen.getByRole('region', { name: 'انتقال به Confluence و Zephyr' });
    expect(within(exportSection).getByText(/Test Data:\s*SD-VENDOR-ACTIVE-001\s*SD-ORDER-PENDING-001/)).toBeInTheDocument();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    await user.click(screen.getByRole('button', { name: 'کپی Reference برای Zephyr' }));
    expect(writeText).toHaveBeenCalledWith('Test Data:\nSD-VENDOR-ACTIVE-001\nSD-ORDER-PENDING-001');
  });

  it('shows the text for manual copying when the clipboard is blocked', async () => {
    const { user } = await generated();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    document.execCommand = vi.fn().mockReturnValue(false);
    await user.click(screen.getByText('فرمت‌های دیگر'));
    await user.click(screen.getByRole('button', { name: /کپی HTML/ }));
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
    await user.click(screen.getByText('فرمت‌های دیگر'));
    await user.click(screen.getByRole('button', { name: /دانلود CSV/ }));
    expect(click).toHaveBeenCalled();
    expect(blob!.type).toBe('text/csv;charset=utf-8');
    const bytes = new Uint8Array(await blob!.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const text = new TextDecoder().decode(bytes.slice(3));
    expect(text.split('\r\n')[0]).toBe(COLUMNS.join(','));
    expect(text).toContain('برای تست سناریوهایی که نیاز به یک Vendor فعال دارند.');
  });
});
