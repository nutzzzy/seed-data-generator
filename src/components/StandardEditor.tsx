import type { Standard } from '../lib/types';

interface Props {
  standard: Standard;
  onChange: (s: Standard) => void;
}

const FIELDS: { key: keyof Standard; label: string; hint: string; rows: number }[] = [
  { key: 'description', label: 'توضیح', hint: 'این استاندارد برای چیست.', rows: 2 },
  { key: 'rules', label: 'قوانین و محدودیت‌ها', hint: 'هر قانون در یک خط.', rows: 6 },
  { key: 'requiredContent', label: 'محتوای اجباری', hint: 'چه چیزی همیشه باید پوشش داده شود.', rows: 2 },
  { key: 'validationCriteria', label: 'معیارهای Validation', hint: 'بازبین چطور تشخیص می‌دهد خروجی درست است.', rows: 3 },
  { key: 'examples', label: 'نمونهٔ خروجی درست', hint: 'اختیاری. یک یا دو نمونه.', rows: 3 },
];

export function StandardEditor({ standard, onChange }: Props) {
  const set = (key: keyof Standard, value: string) => onChange({ ...standard, [key]: value });
  return (
    <div className="stack">
      <label className="field">
        <span>نام استاندارد</span>
        <input value={standard.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      {FIELDS.map((f) => (
        <label className="field" key={f.key}>
          <span>
            {f.label} <small>{f.hint}</small>
          </span>
          <textarea dir="auto" rows={f.rows} value={standard[f.key] as string} onChange={(e) => set(f.key, e.target.value)} />
        </label>
      ))}
    </div>
  );
}
