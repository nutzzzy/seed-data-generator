import { useEffect, useState } from 'react';
import type { AiTransport } from './lib/generate';
import { SeedDataApp } from './seed/SeedDataApp';
import { UseCaseApp } from './usecase/UseCaseApp';

export { providerLabel } from './lib/providerLabel';

interface Props {
  /** Injected in tests; defaults to the local server endpoint. */
  transport?: AiTransport;
}

/** The two independent sections of the app. They share only the UI shell, never data or rules. */
export type Mode = 'seed' | 'usecase';

const MODE_KEY = 'snapp:mode';

function initialMode(): Mode {
  if (typeof window === 'undefined') return 'seed';
  if (window.location.hash === '#usecase') return 'usecase';
  if (window.location.hash === '#seed') return 'seed';
  try {
    return window.localStorage.getItem(MODE_KEY) === 'usecase' ? 'usecase' : 'seed';
  } catch {
    return 'seed';
  }
}

export default function App({ transport }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* the choice is only a convenience */
    }
    if (window.location.hash !== `#${mode}`) window.history.replaceState(null, '', `#${mode}`);
    document.title = mode === 'usecase' ? 'snapp usecase!' : 'snapp seed!';
  }, [mode]);

  const modeSwitch = (
    <nav className="mode-switch" aria-label="بخش‌ها" dir="ltr">
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
