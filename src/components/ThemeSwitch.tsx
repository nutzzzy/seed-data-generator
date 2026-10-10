import { useState } from 'react';
import { applyTheme, loadTheme, saveTheme, type Theme } from '../lib/theme';

const OPTIONS: { value: Theme; label: string; title: string }[] = [
  { value: 'light', label: '☀ روشن', title: 'تم روشن' },
  { value: 'dark', label: '☾ تیره', title: 'تم تیره' },
  { value: 'system', label: 'خودکار', title: 'مثل تنظیمات سیستم' },
];

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  const choose = (next: Theme) => {
    setTheme(next);
    saveTheme(next);
    applyTheme(next);
  };

  return (
    <div className="theme-switch" role="group" aria-label="تم">
      {OPTIONS.map((o) => (
        <button key={o.value} type="button" title={o.title} aria-pressed={theme === o.value} onClick={() => choose(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
