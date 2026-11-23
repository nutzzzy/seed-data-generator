import { useEffect, useState } from 'react';
import type { AiTransport } from './lib/generate';
import { SeedDataApp } from './seed/SeedDataApp';
import { UseCaseApp } from './usecase/UseCaseApp';

export { providerLabel } from './lib/providerLabel';

interface Props {
  /** Injected in tests; defaults to the local server endpoint. */
  transport?: AiTransport;
  /** Show the snapp usecase section and the section switch (hidden from users; tests turn it on). */
  showUseCase?: boolean;
}

/** The Use Case section is hidden from users for now: only snapp seed! is shown, without a section switch. */
export const SHOW_USE_CASE = false;

/** The two independent sections of the app. They share only the UI shell, never data or rules. */
export type Mode = 'seed' | 'usecase';

const MODE_KEY = 'snapp:mode';

function initialMode(showUseCase: boolean): Mode {
  if (typeof window === 'undefined' || !showUseCase) return 'seed';
  if (window.location.hash === '#usecase') return 'usecase';
  if (window.location.hash === '#seed') return 'seed';
  try {
    return window.localStorage.getItem(MODE_KEY) === 'usecase' ? 'usecase' : 'seed';
  } catch {
    return 'seed';
  }
}

export default function App({ transport, showUseCase = SHOW_USE_CASE }: Props) {
  const [mode, setMode] = useState<Mode>(() => initialMode(showUseCase));

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* the choice is only a convenience */
    }
    if (window.location.hash !== `#${mode}`) window.history.replaceState(null, '', `#${mode}`);
    document.title = mode === 'usecase' ? 'snapp usecase!' : 'snapp seed!';
  }, [mode]);

  const modeSwitch = showUseCase && (
    <nav className="mode-switch" aria-label="بخش‌ها" dir="rtl">
      <button type="button" aria-pressed={mode === 'seed'} onClick={() => setMode('seed')}>
        snapp seed!
      </button>
      <button type="button" aria-pressed={mode === 'usecase'} onClick={() => setMode('usecase')}>
        snapp usecase!
      </button>
    </nav>
  );

  return mode === 'usecase' ? <UseCaseApp key="usecase" transport={transport} modeSwitch={modeSwitch} /> : <SeedDataApp key="seed" transport={transport} modeSwitch={modeSwitch} />;
}
