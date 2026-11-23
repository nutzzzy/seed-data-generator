import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { NetworkStatus } from '../lib/networkClient';
import { NetworkSettings } from './NetworkSettings';

const base: NetworkStatus = {
  agentVpn: false,
  state: 'disabled',
  platform: 'linux',
  support: { supported: true, verified: true },
  vpnInterface: 'tun0',
  directInterface: 'wlan0',
  fullTunnel: true,
  message: 'خاموش: همهٔ درخواست‌ها از مسیر پیش‌فرض سیستم‌عامل ارسال می‌شوند.',
};

function fakeApi(initial: NetworkStatus, onToggle: (on: boolean) => NetworkStatus) {
  return {
    status: vi.fn(async () => initial),
    setAgentVpn: vi.fn(async (on: boolean) => onToggle(on)),
    verify: vi.fn(async () => ({
      agent: { host: 'api.anthropic.com', ok: true, via: 'tun0' },
      confluence: { host: 'confluence.example.com', ok: true, via: 'wlan0' },
    })),
  };
}

const toggle = () => screen.getByRole('checkbox', { name: 'استفاده از VPN برای درخواست‌های Agent' });

describe('NetworkSettings', () => {
  it('is off by default and shows the disabled state', async () => {
    render(<NetworkSettings api={fakeApi(base, () => base)} />);
    await waitFor(() => expect(toggle()).not.toBeDisabled());
    expect(toggle()).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('خاموش');
  });

  it('turning it on saves on the server, shows availability and verifies both paths', async () => {
    const api = fakeApi(base, (on) => ({ ...base, agentVpn: on, state: 'available', message: 'Agentها از طریق VPN (tun0) و Confluence مستقیم از طریق wlan0.' }));
    render(<NetworkSettings api={api} />);
    await waitFor(() => expect(toggle()).not.toBeDisabled());
    await userEvent.click(toggle());
    expect(api.setAgentVpn).toHaveBeenCalledWith(true);
    expect(await screen.findByText(/روشن و در دسترس/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'بررسی مسیرها' }));
    expect(await screen.findByText(/Agent \(api.anthropic.com\): از طریق tun0/)).toBeInTheDocument();
    expect(screen.getByText(/Confluence \(confluence.example.com\): از طریق wlan0/)).toBeInTheDocument();
  });

  it('keeps the setting separate from the VPN connection: on but unavailable', async () => {
    render(<NetworkSettings api={fakeApi({ ...base, agentVpn: true, state: 'unavailable', vpnInterface: null, message: 'هیچ VPN وصلی پیدا نشد.' }, () => base)} />);
    await waitFor(() => expect(toggle()).toBeChecked());
    expect(screen.getByRole('status')).toHaveTextContent('روشن اما در دسترس نیست');
  });

  it('cannot be enabled on an unsupported platform, and warns about unvalidated platforms', async () => {
    const { unmount } = render(<NetworkSettings api={fakeApi({ ...base, state: 'unsupported', support: { supported: false, verified: false, note: 'x' }, message: 'پشتیبانی نمی‌شود' }, () => base)} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('پشتیبانی نمی‌شود'));
    expect(toggle()).toBeDisabled();
    unmount();
    render(<NetworkSettings api={fakeApi({ ...base, platform: 'win32', support: { supported: true, verified: false, note: 'هنوز روی Windows آزمایش نشده' } }, () => base)} />);
    expect(await screen.findByText(/هنوز روی Windows آزمایش نشده/)).toBeInTheDocument();
  });

  it('shows server errors', async () => {
    const api = fakeApi(base, () => base);
    api.setAgentVpn.mockRejectedValueOnce(new Error('روی این سیستم‌عامل پشتیبانی نمی‌شود.'));
    render(<NetworkSettings api={api} />);
    await waitFor(() => expect(toggle()).not.toBeDisabled());
    await userEvent.click(toggle());
    expect(await screen.findByRole('alert')).toHaveTextContent('پشتیبانی نمی‌شود');
  });
});
