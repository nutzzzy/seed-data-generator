import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Agent, AgentInput, AgentList, agentsApi } from '../lib/agentsClient';
import { defaultSettings } from '../lib/defaults';
import type { Settings } from '../lib/types';
import { DialogProvider } from './Dialogs';
import { SettingsDialog } from './SettingsDialog';

const PROVIDERS: AgentList['providers'] = [
  { type: 'claude-code', label: 'Claude Code', description: '', fields: [{ key: 'model', label: 'مدل', type: 'text' }] },
  {
    type: 'openai-compatible',
    label: 'سرویس سازگار با OpenAI',
    description: '',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'url', required: true },
      { key: 'model', label: 'مدل', type: 'text', required: true },
      { key: 'apiKey', label: 'کلید API', type: 'text', secret: true },
    ],
  },
];

const TEMPLATES: AgentList['templates'] = [
  { id: 'claude-code', label: 'Claude Code', description: '', providerType: 'claude-code', name: 'Claude Code', settings: {} },
  { id: 'codex', label: 'Codex', description: '', providerType: 'codex-cli', name: 'Codex', settings: {} }, // provider not offered -> hidden
  { id: 'gemini-api', label: 'Gemini API', description: '', providerType: 'openai-compatible', name: 'Gemini API', settings: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' } },
  { id: 'openai-compatible', label: 'سرویس سازگار با OpenAI', description: '', providerType: 'openai-compatible', name: '', settings: {} },
];

const agent = (patch: Partial<Agent>): Agent => ({
  id: 'claude-code',
  name: 'Claude Code',
  providerType: 'claude-code',
  settings: { model: '' },
  enabled: true,
  builtIn: true,
  isDefault: false,
  secrets: {},
  createdAt: '',
  updatedAt: '',
  ...patch,
});

/** An in-memory stand-in for the local /api/agents endpoint. */
function fakeApi(initial: Agent[]) {
  let agents = initial;
  let defaultAgentId: string | null = initial[0]?.id ?? null;
  const list = (): AgentList => ({ agents: agents.map((a) => ({ ...a, isDefault: a.id === defaultAgentId })), defaultAgentId, providers: PROVIDERS, templates: TEMPLATES });
  const api = {
    list: vi.fn(async () => list()),
    importLegacy: vi.fn(async () => list()),
    create: vi.fn(async (input: AgentInput) => {
      const created = agent({
        id: 'agent_new',
        name: input.name!,
        providerType: input.providerType!,
        settings: input.settings!,
        builtIn: false,
        enabled: input.enabled ?? true,
        secrets: { apiKey: { set: Boolean(input.secrets?.apiKey), masked: input.secrets?.apiKey ? '••••cdef' : null, fromEnv: false } },
      });
      agents = [...agents, created];
      return { agent: created, ...list() };
    }),
    update: vi.fn(async (id: string, input: AgentInput) => {
      agents = agents.map((a) => (a.id === id ? { ...a, ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.name ? { name: input.name } : {}) } : a));
      if (input.enabled === false && defaultAgentId === id) defaultAgentId = agents.find((a) => a.enabled)?.id ?? null;
      return { agent: agents.find((a) => a.id === id)!, ...list() };
    }),
    remove: vi.fn(async (id: string) => {
      agents = agents.filter((a) => a.id !== id);
      return list();
    }),
    setDefault: vi.fn(async (id: string) => {
      defaultAgentId = id;
      return list();
    }),
    test: vi.fn(async (input: AgentInput & { id?: string }) =>
      input.secrets?.apiKey === 'wrong' ? { ok: false, message: 'کلید API پذیرفته نشد.' } : { ok: true, message: 'اتصال برقرار است.', models: ['m-1'] },
    ),
  };
  return api as typeof api & typeof agentsApi;
}

function renderDialog(settings: Settings, api: ReturnType<typeof fakeApi>) {
  const onSave = vi.fn<(s: Settings) => void>();
  const user = userEvent.setup();
  render(
    <DialogProvider>
      <SettingsDialog settings={settings} onSave={onSave} onClose={() => {}} api={api} />
    </DialogProvider>,
  );
  return { user, onSave };
}

const SECOND = agent({ id: 'agent_2', name: 'OpenRouter', providerType: 'openai-compatible', settings: { baseUrl: 'https://x/v1', model: 'm' }, builtIn: false });

describe('Agent management', () => {
  it('migrates the old settings: the old provider stays selected and saving switches to its agent', async () => {
    const api = fakeApi([agent({})]);
    const { user, onSave } = renderDialog({ ...defaultSettings, claudeCodeModel: 'sonnet' }, api);
    expect(await screen.findByRole('radio', { name: 'Claude Code' })).toBeChecked();
    expect(api.importLegacy).toHaveBeenCalledWith(expect.objectContaining({ claudeCodeModel: 'sonnet' }));
    await user.click(screen.getByRole('button', { name: 'ذخیرهٔ تنظیمات' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ provider: 'agent', agentId: 'claude-code', agentName: 'Claude Code' }));
  });

  it('switches between agents and back to the offline mode', async () => {
    const api = fakeApi([agent({}), SECOND]);
    const { user, onSave } = renderDialog({ ...defaultSettings, provider: 'agent', agentId: 'claude-code' }, api);
    await user.click(await screen.findByRole('radio', { name: 'OpenRouter' }));
    await user.click(screen.getByRole('button', { name: 'ذخیرهٔ تنظیمات' }));
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'agent', agentId: 'agent_2' }));
    expect(api.importLegacy).not.toHaveBeenCalled();
  });

  it('adds an agent with a key that is sent once and only shown masked afterwards', async () => {
    const api = fakeApi([agent({})]);
    const { user } = renderDialog(defaultSettings, api);
    await user.click(await screen.findByRole('button', { name: '+ افزودن Agent' }));
    // Templates whose provider the server offers; the first is preselected.
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['Claude Code', 'Gemini API', 'سرویس سازگار با OpenAI']);
    expect(screen.getByRole('radio', { name: 'Claude Code' })).toBeChecked();

    // A template fills in the provider, a name and its settings.
    await user.click(screen.getByRole('radio', { name: 'Gemini API' }));
    expect(screen.getByRole('textbox', { name: 'نام Agent' })).toHaveValue('Gemini API');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://generativelanguage.googleapis.com/v1beta/openai');

    await user.click(screen.getByRole('radio', { name: 'سرویس سازگار با OpenAI' }));
    expect(screen.getByLabelText('Base URL')).toHaveValue('');
    await user.clear(screen.getByRole('textbox', { name: 'نام Agent' }));
    await user.type(screen.getByRole('textbox', { name: 'نام Agent' }), 'My GPT');
    await user.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
    await user.type(screen.getByRole('textbox', { name: 'مدل' }), 'gpt-x');
    const keyInput = screen.getByLabelText('کلید API');
    expect(keyInput).toHaveAttribute('type', 'password');

    await user.type(keyInput, 'wrong');
    await user.click(screen.getByRole('button', { name: 'بررسی اتصال' }));
    expect(await screen.findByText(/کلید API پذیرفته نشد/)).toBeInTheDocument();

    await user.clear(keyInput);
    await user.type(keyInput, 'sk-test-0123456789abcdef');
    await user.click(screen.getByRole('button', { name: 'افزودن Agent' }));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.create.mock.calls[0][0]).toMatchObject({
      name: 'My GPT',
      providerType: 'openai-compatible',
      settings: { baseUrl: 'https://api.example.com/v1', model: 'gpt-x' },
      secrets: { apiKey: 'sk-test-0123456789abcdef' },
    });
    // Back on the list, the new agent is selected; the key itself is nowhere on the page.
    expect(await screen.findByRole('radio', { name: 'My GPT' })).toBeChecked();
    expect(document.body.innerHTML).not.toContain('sk-test-0123456789abcdef');
  });

  it('disables, makes default, tests and removes agents; a disabled agent cannot be chosen', async () => {
    const api = fakeApi([agent({}), SECOND]);
    const { user, onSave } = renderDialog({ ...defaultSettings, provider: 'agent', agentId: 'agent_2' }, api);
    const row = () => screen.getByRole('radio', { name: 'OpenRouter' }).closest('.agent-row') as HTMLElement;
    await screen.findByRole('radio', { name: 'OpenRouter' });

    await user.click(within(row()).getByRole('button', { name: 'بررسی اتصال' }));
    expect(await within(row()).findByText(/اتصال برقرار است/)).toBeInTheDocument();

    await user.click(within(row()).getByRole('button', { name: 'پیش‌فرض شود' }));
    expect(api.setDefault).toHaveBeenCalledWith('agent_2');
    expect(await within(row()).findByText('پیش‌فرض')).toBeInTheDocument();

    await user.click(within(row()).getByRole('button', { name: 'غیرفعال کردن' }));
    expect(await within(row()).findByText('غیرفعال')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'OpenRouter' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'ذخیرهٔ تنظیمات' }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('غیرفعال');

    await user.click(within(row()).getByRole('button', { name: 'حذف OpenRouter' }));
    await user.click(await screen.findByRole('button', { name: 'حذف' }));
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'OpenRouter' })).not.toBeInTheDocument());
    expect(api.remove).toHaveBeenCalledWith('agent_2');
  });

  it('still allows the offline mode when the local server cannot be reached', async () => {
    const api = fakeApi([]);
    api.importLegacy.mockRejectedValue(new Error('سرور محلی در دسترس نیست.'));
    const { user, onSave } = renderDialog(defaultSettings, api);
    expect(await screen.findByText(/سرور محلی در دسترس نیست/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /ساده/ }));
    await user.click(screen.getByRole('button', { name: 'ذخیرهٔ تنظیمات' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ provider: 'basic', agentId: undefined }));
  });
});
