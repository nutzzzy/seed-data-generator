import type { Standard } from '../lib/types';

interface Props {
  standard: Standard;
  onChange: (s: Standard) => void;
}

const FIELDS: { key: keyof Standard; label: string; hint: string; rows: number }[] = [
  { key: 'description', label: 'Description', hint: 'What this standard is for.', rows: 2 },
  { key: 'rules', label: 'Rules and constraints', hint: 'One rule per line.', rows: 4 },
  { key: 'requiredContent', label: 'Required content', hint: 'What must always be covered.', rows: 2 },
  { key: 'validationCriteria', label: 'Validation criteria', hint: 'How a reviewer decides the table is correct.', rows: 2 },
  { key: 'examples', label: 'Examples of correct output', hint: 'Optional. A sample row or two.', rows: 2 },
];

export function StandardEditor({ standard, onChange }: Props) {
  const set = (key: keyof Standard, value: string) => onChange({ ...standard, [key]: value });
  return (
    <div className="stack">
      <label className="field">
        <span>Standard name</span>
        <input value={standard.name} onChange={(e) => set('name', e.target.value)} />
      </label>
      {FIELDS.map((f) => (
        <label className="field" key={f.key}>
          <span>
            {f.label} <small>{f.hint}</small>
          </span>
          <textarea rows={f.rows} value={standard[f.key] as string} onChange={(e) => set(f.key, e.target.value)} />
        </label>
      ))}
    </div>
  );
}
