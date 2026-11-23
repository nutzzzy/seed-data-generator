import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SlowGenerationPrompt, useSlowConfirm } from './SlowGenerationPrompt';

let api: ReturnType<typeof useSlowConfirm>;
function Harness() {
  api = useSlowConfirm();
  return <SlowGenerationPrompt pending={api.pending} answer={api.answer} />;
}

describe('SlowGenerationPrompt', () => {
  it('asks after a long generation and returns the answer', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    let answer!: Promise<boolean>;
    act(() => void (answer = api.ask(120)));
    expect(screen.getByRole('alertdialog', { name: 'ساخت طولانی شده است' })).toHaveTextContent('بیش از ۱۲۰ ثانیه');
    await user.click(screen.getByRole('button', { name: 'ادامه' }));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    act(() => void (answer = api.ask(240)));
    await user.click(screen.getByRole('button', { name: 'توقف ساخت' }));
    await expect(answer).resolves.toBe(false);
  });

  it('closes an open question when the generation ends on its own', async () => {
    render(<Harness />);
    let answer!: Promise<boolean>;
    act(() => void (answer = api.ask(120)));
    act(() => api.settle());
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
