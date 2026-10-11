import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { DialogProvider } from '../components/Dialogs';
import { ToastProvider } from '../components/Toasts';
import type { AiTransport } from '../lib/generate';
import { STORAGE_KEY } from '../lib/storage';
import { OVERVIEW_STORAGE, USE_CASE_STORAGE } from './fixtures';
import { UC_STORAGE_KEY } from './storage';
import type { UcWorkspace } from './types';

// Mermaid needs a real browser layout engine; the preview is not what these tests check.
vi.mock('./render', () => ({
  renderMermaid: vi.fn().mockResolvedValue('<svg></svg>'),
  mermaidToPng: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  dataUrlToBase64: (s: string) => s.slice(s.indexOf(',') + 1),
}));

function renderApp(transport?: AiTransport) {
  const user = userEvent.setup();
  render(
    <ToastProvider>
      <DialogProvider>
        <App transport={transport} />
      </DialogProvider>
    </ToastProvider>,
  );
  return user;
}

const stored = (): UcWorkspace => JSON.parse(localStorage.getItem(UC_STORAGE_KEY) ?? 'null');

function pasteHtml(html: string) {
  const area = screen.getByLabelText('لینک یا محتوای صفحهٔ Confluence');
  fireEvent.paste(area, { clipboardData: { getData: (type: string) => (type === 'text/html' ? html : 'copied text') } });
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '#');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ baseUrl: 'https://confluence.snappfood.ir', tokenSet: false })));
});

describe('snapp usecase section', () => {
  it('is a separate section with its own storage', async () => {
    const user = renderApp();
    expect(screen.getByRole('heading', { name: 'snapp seed!' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'snapp usecase!' }));
    expect(screen.getByRole('heading', { name: 'snapp usecase!' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'شروع' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#usecase');
    await user.click(screen.getByRole('button', { name: 'snapp seed!' }));
    expect(screen.getByRole('heading', { name: 'snapp seed!' })).toBeInTheDocument();
  });

  it('imports a pasted Use Case page, checks the rules live and keeps edits', async () => {
    window.location.hash = '#usecase';
    const user = renderApp();
    await user.type(screen.getByLabelText('لینک یا محتوای صفحهٔ Confluence'), 'https://confluence.snappfood.ir/spaces/FP/pages/1/x');
    expect(await screen.findByText(/CONFLUENCE_TOKEN/)).toBeInTheDocument();
    await user.clear(screen.getByLabelText('لینک یا محتوای صفحهٔ Confluence'));
    pasteHtml(USE_CASE_STORAGE);
    await user.click(screen.getByRole('button', { name: 'ایمپورت' }));
    expect(await screen.findByText(/Use Case «UC-Creates-New-Coupon» ایمپورت شد/)).toBeInTheDocument();
    expect(screen.getByLabelText('Use Case ID')).toHaveValue('UC-Creates-New-Coupon');
    expect(screen.getByLabelText('عنوان Flow ۲')).toHaveValue('ورود درصد تخفیف نامعتبر');

    await user.clear(screen.getByLabelText('Use Case ID'));
    await user.type(screen.getByLabelText('Use Case ID'), 'UC Bad ID');
    expect(screen.getByText(/با الگوی UC-… نمی‌خواند/)).toBeInTheDocument();
    await waitFor(() => expect(stored().docs[0]).toMatchObject({ kind: 'usecase', useCase: { ucId: 'UC Bad ID' } }));
    // Seed Data's storage is untouched.
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('draws the flowchart from the algorithm without AI', async () => {
    window.location.hash = '#usecase';
    const user = renderApp();
    pasteHtml(USE_CASE_STORAGE);
    await user.click(screen.getByRole('button', { name: 'ایمپورت' }));
    await user.click(await screen.findByRole('tab', { name: /فلوچارت/ }));
    await user.click(screen.getByRole('button', { name: 'رسم از روی الگوریتم' }));
    const code = screen.getByLabelText('کد Mermaid بخش 1') as HTMLTextAreaElement;
    expect(code.value).toContain('Start --> Step1["Vendor روی دکمه «ایجاد کوپن جدید» کلیک می‌کند."]');
  });

  it('imports the diagram page with all its sections', async () => {
    window.location.hash = '#usecase';
    const user = renderApp();
    pasteHtml(OVERVIEW_STORAGE);
    await user.click(screen.getByRole('button', { name: 'ایمپورت' }));
    expect(await screen.findByText(/صفحهٔ نمودارها با ۲ بخش ایمپورت شد/)).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'بخش‌های صفحه' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(
      expect.arrayContaining(['1. Vendor User / Profile — Vendor Registration Service', '2. Coupon — Coupon Service']),
    );
    // One section at a time: section 2 opens on click.
    await user.click(within(nav).getByRole('button', { name: /2\. Coupon/ }));
    expect((screen.getByLabelText('کد Mermaid بخش 2') as HTMLTextAreaElement).value).toContain('CouponSvc --> CreateCoupon');
    // Export dialog offers the main actions first.
    await user.click(screen.getByRole('button', { name: 'خروجی برای Confluence' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /کپی برای Confluence/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /دانلود تصویر نمودار/ })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'بستن' }));
    // Back to the documents list.
    await user.click(screen.getByRole('button', { name: '→ اسناد' }));
    expect(screen.getByRole('heading', { name: 'اسناد شما' })).toBeInTheDocument();
  });

  it('generates a Use Case and its flowchart with AI', async () => {
    window.location.hash = '#usecase';
    const transport = vi.fn<AiTransport>().mockResolvedValue(
      JSON.stringify({
        useCase: {
          ucId: 'UC-Cancel-Purchase-Reward',
          title: 'Vendor Cancels a Purchase Reward',
          scope: 'Cashback',
          primaryActor: 'Vendor',
          preconditions: ['Vendor وارد پنل شده باشد.'],
          postconditions: ['جایزه لغو شده است.'],
          mainScenario: ['Vendor روی «لغو» کلیک می‌کند.', 'سیستم پیام تأیید نمایش می‌دهد.', '  گزینهٔ «بله»'],
          extensions: [{ title: 'انصراف از لغو', steps: ['Vendor روی «خیر» کلیک می‌کند.'] }],
          exceptions: ['خطای سیستمی'],
          specialRequirements: [],
          relatedUseCases: ['UC-Cashback-01'],
        },
        flowchart: { heading: 'Cashback — CashBack Service', description: 'Cancel flow.', mermaid: 'flowchart LR\nA["Cancel"] --> B["Done"]' },
        issues: ['متن پیام تأیید مشخص نشده است.'],
      }),
    );
    const user = renderApp(transport);
    await user.click(screen.getByRole('tab', { name: 'ساخت با AI' }));
    await user.type(screen.getByLabelText('نیازمندی‌های Use Case'), 'لغو جایزهٔ خرید بعدی');
    await user.click(screen.getByRole('button', { name: 'ساخت Use Case و فلوچارت' }));
    expect(await screen.findByText(/«UC-Cancel-Purchase-Reward» و فلوچارت آن ساخته شد/)).toBeInTheDocument();
    expect(transport.mock.calls[0][0].system).toContain('Main Success Scenario is the happy path only');
    expect(screen.getByLabelText('Main Success Scenario')).toHaveValue('Vendor روی «لغو» کلیک می‌کند.\nسیستم پیام تأیید نمایش می‌دهد.\n  گزینهٔ «بله»');
    await user.click(screen.getByRole('tab', { name: /فلوچارت/ }));
    expect(screen.getByLabelText('کد Mermaid بخش 1')).toHaveValue('flowchart LR\n    A["Cancel"] --> B["Done"]');
    expect(screen.getByText('متن پیام تأیید مشخص نشده است.')).toBeInTheDocument();
  });
});
