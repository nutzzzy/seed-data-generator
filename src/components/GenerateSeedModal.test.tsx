import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '../lib/agentsClient';
import { defaultSettings, seedDataStandard, seedDataTemplate } from '../lib/defaults';
import type { AiTransport } from '../lib/generate';
import { ApiError, type ConfluenceStatus, type JobView, type PublishResult } from '../lib/seedJobsClient';
import type { GeneratedTable } from '../lib/types';
import { DialogProvider } from './Dialogs';
import { GenerateSeedModal, type ModalApis } from './GenerateSeedModal';
import { ToastProvider } from './Toasts';
import { SEED_ROW } from '../test/seedFixtures';

const BASE = 'https://confluence.snappfood.ir';
const URL_OK = `${BASE}/spaces/FP/pages/1/Food+Partner`;

const AGENT: Agent = {
  id: 'claude-code',
  name: 'Claude Code',
  providerType: 'claude-code',
  settings: {},
  enabled: true,
  builtIn: true,
  isDefault: true,
  secrets: {},
  createdAt: '',
  updatedAt: '',
};

const baseJob: JobView = {
  id: 'job_1',
  status: 'retrieving',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  url: URL_OK,
  request: 'Active vendor',
  instructions: '',
  progress: { read: 1, current: 'Food Partner' },
  pages: [
    { id: '1', title: 'Bordar', url: `${BASE}/p/1`, version: 1, spaceKey: 'QC', parentId: null, depth: 0 },
    { id: '2', title: 'Seed Data – Inactive Bordar Vendor - Tehran', url: `${BASE}/p/2`, version: 3, spaceKey: 'QC', parentId: '1', depth: 1 },
  ],
  failures: [],
  skippedByLimit: 0,
  seedEntries: 0,
  excludedReferences: [],
  duplicates: [],
  existingIds: ['SD-BORDAR-VENDOR-ACTIVE-001', 'SD-BORDAR-VENDOR-INACTIVE-001'],
  domains: [
    { code: 'FP', name: 'Food Partner' },
    { code: 'BORDAR', name: 'Bordar', pageId: '1', url: `${BASE}/p/1` },
  ],
  notes: [],
};
const CONTEXT = { text: '<project_skill>QA</project_skill>\n<confluence_documentation>Vendors…</confluence_documentation>', included: ['Bordar'], omitted: [] };

/** What the agent answers: v4 fields; its ID collides with an existing one and must become -002. */
const ROW = SEED_ROW;
const NEXT_ID = 'SD-BORDAR-VENDOR-INACTIVE-002';

function setup(options: { tokenSet?: boolean; jobs: JobView[]; publish?: (id: string, body: unknown) => Promise<PublishResult>; extraAgents?: Agent[]; row?: Record<string, string> }) {
  let status: ConfluenceStatus = { baseUrl: BASE, tokenSet: options.tokenSet ?? true, source: options.tokenSet === false ? null : 'app', authType: 'bearer', masked: null };
  const jobStates = [...options.jobs];
  let current = jobStates[0];
  const apis = {
    agents: {
      list: vi.fn(async () => ({ agents: [AGENT, ...(options.extraAgents ?? [])], defaultAgentId: 'claude-code', providers: [], templates: [] })),
      test: vi.fn(async ({ id }: { id?: string }) =>
        id === 'broken' ? { ok: false, message: 'Cursor وارد حساب نشده است.' } : { ok: true, message: 'Claude Code پیدا شد.' },
      ),
    },
    confluence: {
      status: vi.fn(async () => status),
      test: vi.fn(async () => ({ ok: true, message: 'اتصال برقرار است.' })),
      save: vi.fn(async () => (status = { ...status, tokenSet: true, source: 'app', masked: '••••abcd' })),
      remove: vi.fn(async () => status),
    },
    jobs: {
      start: vi.fn(async () => ({ id: 'job_1' })),
      get: vi.fn(async () => {
        current = jobStates.length > 1 ? jobStates.shift()! : jobStates[0];
        return current;
      }),
      decide: vi.fn(async (_id: string, action: string, targetPageId?: string) =>
        action === 'cancel'
          ? { ...current, status: 'cancelled' as const }
          : { ...current, status: 'ready' as const, decision: { action: action as 'new' | 'overwrite', targetPageId }, context: CONTEXT },
      ),
      target: vi.fn(async () => ({ id: '2', title: 'Seed Data – Inactive Bordar Vendor - Tehran', version: 3, storage: '<h3>SD-BORDAR-VENDOR-INACTIVE-001</h3><p>old</p>', url: `${BASE}/p/2` })),
      cancel: vi.fn(async () => current),
      publish: vi.fn(
        options.publish ??
          (async (_id: string, _body: unknown) =>
            ({
              operation: 'create',
              pages: [{ pageId: '999', title: NEXT_ID, url: `${BASE}/p/999`, version: 1, labels: ['seed_data', 'sd-bordar', 'sd-vendor', 'env-stage'] }],
              agentName: 'Claude Code',
              publishedAt: '2026-11-09T10:00:00.000Z',
            }) as PublishResult),
      ),
    },
  };
  const transport = vi.fn<AiTransport>().mockResolvedValue(JSON.stringify({ rows: [options.row ?? ROW], issues: [{ row: 1, column: 'Environment', message: 'فرض شد محیط stage است.' }] }));
  const onGenerated = vi.fn<(t: GeneratedTable) => void>();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <DialogProvider>
        <GenerateSeedModal
          settings={defaultSettings}
          standard={seedDataStandard}
          template={seedDataTemplate}
          initialRequest="Active vendor"
          transport={transport}
          onGenerated={onGenerated}
          onClose={onClose}
          apis={apis as unknown as ModalApis}
          pollMs={5}
        />
      </DialogProvider>
    </ToastProvider>,
  );
  return { user, apis, transport, onGenerated, onClose };
}

async function startWith(user: ReturnType<typeof userEvent.setup>, url = URL_OK) {
  await user.type(await screen.findByRole('textbox', { name: 'لینک صفحهٔ Confluence' }), url);
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Agent' })).toHaveValue('claude-code'));
  await user.click(screen.getByRole('button', { name: 'شروع' }));
}

describe('Seed Data generation modal', () => {
  it('asks for the Confluence token inside the modal when none is configured', async () => {
    const { user, apis } = setup({ tokenSet: false, jobs: [baseJob] });
    expect(await screen.findByText(/اول اتصال را تنظیم کنید/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'شروع' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'لینک صفحهٔ Confluence' }), URL_OK);
    await user.type(screen.getByLabelText('توکن Confluence'), 'pat-0123456789abcd');
    await user.click(screen.getByRole('button', { name: 'ذخیرهٔ تنظیمات Confluence' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'شروع' })).toBeEnabled());
    expect(apis.confluence.save).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: BASE, authType: 'bearer', token: 'pat-0123456789abcd' }));
    expect(screen.queryByText(/اول اتصال را تنظیم کنید/)).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('pat-0123456789abcd');
  });

  it('only accepts links on the configured Confluence, and says so next to the Start button', async () => {
    const { user, apis } = setup({ jobs: [baseJob] });
    await user.type(await screen.findByRole('textbox', { name: 'لینک صفحهٔ Confluence' }), 'https://example.com/pages/1');
    expect(screen.getByRole('status', { name: 'موارد لازم برای شروع' })).toHaveTextContent('لینک باید از confluence.snappfood.ir باشد');
    expect(screen.getByRole('button', { name: 'شروع' })).toBeDisabled();
    expect(apis.jobs.start).not.toHaveBeenCalled();
  });

  it('explains why Start is disabled when the Confluence connection was only tested, not saved', async () => {
    const { user, apis } = setup({ tokenSet: false, jobs: [baseJob] });
    await user.type(await screen.findByRole('textbox', { name: 'لینک صفحهٔ Confluence' }), URL_OK);
    await user.type(screen.getByLabelText('توکن Confluence'), 'pat-0123456789abcd');
    await user.click(screen.getByRole('button', { name: 'بررسی اتصال' }));
    expect(await screen.findByText(/هنوز ذخیره نشده است/)).toBeInTheDocument();
    expect(apis.confluence.save).not.toHaveBeenCalled();
    const missing = screen.getByRole('status', { name: 'موارد لازم برای شروع' });
    expect(missing).toHaveTextContent('اتصال Confluence ذخیره نشده است');
    expect(missing).not.toHaveTextContent('لینک');
    expect(screen.getByRole('button', { name: 'شروع' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'ذخیرهٔ تنظیمات Confluence' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'شروع' })).toBeEnabled());
    expect(screen.queryByRole('status', { name: 'موارد لازم برای شروع' })).not.toBeInTheDocument();
  });

  it('flags an Anthropic agent without a key as soon as it is selected', async () => {
    const noKey: Agent = { ...AGENT, id: 'anthropic', name: 'Claude (Anthropic API)', providerType: 'anthropic', isDefault: false, secrets: { apiKey: { set: false, masked: null, fromEnv: false } } };
    const { user, apis } = setup({ jobs: [baseJob], extraAgents: [noKey] });
    await user.type(await screen.findByRole('textbox', { name: 'لینک صفحهٔ Confluence' }), URL_OK);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Agent' })).toHaveValue('claude-code'));
    expect(screen.getByRole('button', { name: 'شروع' })).toBeEnabled();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'anthropic');
    expect(screen.getByRole('status', { name: 'موارد لازم برای شروع' })).toHaveTextContent('کلید API ندارد');
    expect(screen.getByRole('button', { name: 'شروع' })).toBeDisabled();
    expect(apis.jobs.start).not.toHaveBeenCalled();
  });

  it('tests the agent before reading Confluence and stops with its message when it is not ready', async () => {
    const broken: Agent = { ...AGENT, id: 'broken', name: 'Cursor', providerType: 'cursor-cli', isDefault: false };
    const { user, apis } = setup({ jobs: [baseJob], extraAgents: [broken] });
    await user.type(await screen.findByRole('textbox', { name: 'لینک صفحهٔ Confluence' }), URL_OK);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Agent' })).toHaveValue('claude-code'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Agent' }), 'broken');
    await user.click(screen.getByRole('button', { name: 'شروع' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Agent «Cursor» آماده نیست: Cursor وارد حساب نشده است.');
    expect(apis.agents.test).toHaveBeenCalledWith({ id: 'broken' });
    expect(apis.jobs.start).not.toHaveBeenCalled();
  });

  it('shows similar Seed Data with links and lets the user stop without generating', async () => {
    const withDuplicate: JobView = {
      ...baseJob,
      status: 'awaiting-decision',
      seedEntries: 2,
      duplicates: [
        {
          pageId: '2',
          pageTitle: 'Seed Data – Vendors',
          pageUrl: `${BASE}/p/2`,
          seedDataId: 'SD-VENDOR-ACTIVE-001',
          similarity: 'exact',
          explanation: 'همان Vendor فعال با همان Vendor ID',
          matchingFields: ['Vendor ID', 'Status'],
          lastUpdated: '2026-10-01T10:00:00.000Z',
          updatedBy: 'QA Lead',
        },
      ],
    };
    const { user, apis, transport, onClose } = setup({ jobs: [baseJob, withDuplicate] });
    await startWith(user);
    expect(await screen.findByText(/Seed Data مشابه در Confluence پیدا شد/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Seed Data – Vendors' })).toHaveAttribute('href', `${BASE}/p/2`);
    expect(screen.getByText('همان Vendor فعال با همان Vendor ID')).toBeInTheDocument();
    expect(screen.getByText(/Vendor ID، Status/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /بازنویسی صفحهٔ انتخاب‌شده/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'ساخته نشود' }));
    expect(apis.jobs.decide).toHaveBeenCalledWith('job_1', 'cancel', undefined);
    expect(onClose).toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(apis.jobs.publish).not.toHaveBeenCalled();
  });

  it('generates with the selected agent, numbers the ID, and publishes one page per Seed Data under its Domain page only after approval', async () => {
    const ready: JobView = { ...baseJob, status: 'ready', decision: { action: 'new' }, context: CONTEXT };
    const { user, apis, transport, onGenerated } = setup({ jobs: [baseJob, ready] });
    await startWith(user);

    const frame = (await screen.findByTitle(`پیش‌نمایش ${NEXT_ID}`)) as HTMLIFrameElement;
    const req = transport.mock.calls[0][0];
    expect(req).toMatchObject({ provider: 'agent', agentId: 'claude-code' });
    expect(req.user).toContain('<project_skill>QA</project_skill>');
    expect(onGenerated.mock.lastCall![0].rows[0].cells.col_sd_id).toBe(NEXT_ID);
    // The agent's ID already existed: it gets the next free number, and the user is told.
    expect(screen.getByText(/SD-BORDAR-VENDOR-INACTIVE-001 → SD-BORDAR-VENDOR-INACTIVE-002/)).toBeInTheDocument();
    expect(screen.getByText(/«Environment»: فرض شد محیط stage است/)).toBeInTheDocument();
    expect(screen.getByText('ساخت ۱ صفحهٔ جدید')).toBeInTheDocument();
    // Page title = ID, under the Bordar Domain page, with the guide's labels.
    expect(screen.getByRole('combobox', { name: `صفحهٔ والد ${NEXT_ID}` })).toHaveValue('1');
    expect(screen.getByText('seed_data · sd-bordar · sd-vendor · env-stage')).toBeInTheDocument();
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('srcdoc')).toContain('page-properties');

    const publish = screen.getByRole('button', { name: 'تأیید و انتشار' });
    expect(publish).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /پیش‌نمایش را بررسی کردم/ }));
    await user.click(publish);

    await screen.findByText('۱ صفحهٔ جدید ساخته شد.', { exact: false });
    const body = apis.jobs.publish.mock.calls[0][1] as { approved: boolean; mode: string; pages: { title: string; parentId: string; labels: string[]; storage: string }[] };
    expect(body).toMatchObject({ approved: true, mode: 'create' });
    expect(body.pages).toHaveLength(1);
    expect(body.pages[0]).toMatchObject({ title: NEXT_ID, parentId: '1', labels: ['seed_data', 'sd-bordar', 'sd-vendor', 'env-stage'] });
    expect(body.pages[0].storage).toContain(`<tr><th>Seed Data ID</th><td>${NEXT_ID}</td></tr>`);
    expect(screen.getByRole('link', { name: 'باز کردن در Confluence' })).toHaveAttribute('href', `${BASE}/p/999`);
    expect(screen.getByText('999')).toBeInTheDocument();
  });

  it('never publishes a descriptive title: an ID outside the naming convention blocks publishing', async () => {
    const ready: JobView = { ...baseJob, status: 'ready', decision: { action: 'new' }, context: CONTEXT };
    const { user, apis } = setup({ jobs: [baseJob, ready], row: { ...ROW, 'Seed Data ID': 'Seed Data – Inactive Bordar Vendor - Tehran' } });
    await startWith(user);
    expect(await screen.findByText(/طبق قالب SD-\[DOMAIN\]-\[ENTITY\]-\[STATE\]-\[NNN\] نیست/)).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /پیش‌نمایش را بررسی کردم/ }));
    expect(screen.getByRole('button', { name: 'تأیید و انتشار' })).toBeDisabled();
    expect(apis.jobs.publish).not.toHaveBeenCalled();
  });

  it('editing the preview withdraws the approval', async () => {
    const ready: JobView = { ...baseJob, status: 'ready', decision: { action: 'new' }, context: CONTEXT };
    const { user } = setup({ jobs: [baseJob, ready] });
    await startWith(user);
    await screen.findByTitle(`پیش‌نمایش ${NEXT_ID}`);
    await user.click(screen.getByRole('checkbox', { name: /پیش‌نمایش را بررسی کردم/ }));
    await user.click(screen.getByRole('tab', { name: 'ویرایش' }));
    await user.type(screen.getByRole('textbox', { name: 'ردیف 1، Name' }), ' 2');
    expect(screen.getByRole('checkbox', { name: /پیش‌نمایش را بررسی کردم/ })).not.toBeChecked();
    await user.click(screen.getByRole('tab', { name: 'پیش‌نمایش Confluence' }));
    expect((screen.getByTitle(`پیش‌نمایش ${NEXT_ID}`) as HTMLIFrameElement).getAttribute('srcdoc')).toContain('Inactive Bordar Vendor - Tehran 2');
  });

  it('overwrite: before/after, the page is renamed to the ID, and a fresh approval is needed after a version conflict', async () => {
    const withDuplicate: JobView = {
      ...baseJob,
      status: 'awaiting-decision',
      duplicates: [{ pageId: '2', pageTitle: 'Seed Data – Inactive Bordar Vendor - Tehran', pageUrl: `${BASE}/p/2`, similarity: 'exact', explanation: 'x', matchingFields: [] }],
    };
    let calls = 0;
    const { user, apis } = setup({
      jobs: [baseJob, withDuplicate],
      publish: async (_id: string, _body: unknown) => {
        calls++;
        if (calls === 1) throw new ApiError(409, 'صفحه بعد از پیش‌نمایش تغییر کرده است.', { conflict: { version: 4, title: 'Seed Data – Inactive Bordar Vendor - Tehran', storage: '<p>colleague edit</p>' } });
        return { operation: 'update', pages: [{ pageId: '2', title: NEXT_ID, url: `${BASE}/p/2`, version: 5, labels: [] }], agentName: 'Claude Code', publishedAt: '2026-11-09T10:00:00.000Z' };
      },
    });
    await startWith(user);
    await user.click(await screen.findByRole('radio', { name: 'بازنویسی Seed Data – Inactive Bordar Vendor - Tehran' }));
    await user.click(screen.getByRole('button', { name: /بازنویسی صفحهٔ انتخاب‌شده/ }));

    expect(await screen.findByText('به‌روزرسانی صفحهٔ موجود')).toBeInTheDocument();
    expect(screen.getByText(/عنوان صفحه به SD-BORDAR-VENDOR-INACTIVE-00\d تغییر می‌کند/)).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'قبل / بعد' }));
    expect((screen.getByTitle('محتوای فعلی صفحه') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('old');
    expect((screen.getByTitle('محتوای بعد از به‌روزرسانی') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('page-properties');

    await user.click(screen.getByRole('checkbox', { name: /پیش‌نمایش را بررسی کردم/ }));
    await user.click(screen.getByRole('button', { name: 'تأیید و انتشار' }));
    const dialog = await screen.findByRole('dialog', { name: /به‌روزرسانی شود؟/ });
    expect(dialog).toHaveTextContent('عنوان صفحه از «Seed Data – Inactive Bordar Vendor - Tehran» به');
    await user.click(within(dialog).getByRole('button', { name: 'بله، به‌روزرسانی شود' }));
    expect(apis.jobs.publish).toHaveBeenLastCalledWith('job_1', expect.objectContaining({ approved: true, mode: 'update', pageId: '2', expectedVersion: 3 }));
    expect((apis.jobs.publish.mock.lastCall![1] as { title: string }).title).toMatch(/^SD-BORDAR-VENDOR-INACTIVE-00\d$/);

    // Conflict: the new page version is shown and approval is needed again.
    expect(await screen.findByText('صفحه بعد از پیش‌نمایش تغییر کرده است.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /پیش‌نمایش را بررسی کردم/ })).not.toBeChecked();
    expect((screen.getByTitle('محتوای فعلی صفحه') as HTMLIFrameElement).getAttribute('srcdoc')).toContain('colleague edit');
    await user.click(screen.getByRole('checkbox', { name: /پیش‌نمایش را بررسی کردم/ }));
    await user.click(screen.getByRole('button', { name: 'تأیید و انتشار' }));
    await user.click(within(await screen.findByRole('dialog', { name: /به‌روزرسانی شود؟/ })).getByRole('button', { name: 'بله، به‌روزرسانی شود' }));
    await screen.findByText('صفحه به‌روزرسانی شد.', { exact: false });
    expect((apis.jobs.publish.mock.lastCall![1] as { expectedVersion: number }).expectedVersion).toBe(4);
  });

  it('copies the generated data without publishing', async () => {
    const ready: JobView = { ...baseJob, status: 'ready', decision: { action: 'new' }, context: CONTEXT };
    const { user, apis } = setup({ jobs: [baseJob, ready] });
    await startWith(user);
    await screen.findByTitle(`پیش‌نمایش ${NEXT_ID}`);
    await user.click(screen.getByRole('tab', { name: 'کپی و خروجی' }));
    await user.click(screen.getByRole('button', { name: 'کپی دادهٔ ساخت‌یافته (JSON)' }));
    expect(JSON.parse(await navigator.clipboard.readText())).toEqual([{ ...ROW, 'Seed Data ID': NEXT_ID }]);
    expect(screen.getByRole('button', { name: 'کپی این صفحه' })).toBeInTheDocument();
    expect(apis.jobs.publish).not.toHaveBeenCalled();
  });
});
