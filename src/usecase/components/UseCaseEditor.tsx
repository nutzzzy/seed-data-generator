import { blankExtension, moveItem } from '../model';
import { UC_HEADINGS, UC_LABELS } from '../rules';
import type { Extension, UseCase } from '../types';

interface Props {
  useCase: UseCase;
  onChange: (uc: UseCase) => void;
}

const OUTLINE_HINT = 'در فهرست‌ها هر خط یک مورد است. زیرمورد: دو فاصله در ابتدای خط. زیرعنوان: «### ». شکست خط داخل یک مورد: « \\» در انتهای خط.';

const HEADER: { key: 'ucId' | 'title' | 'scope' | 'primaryActor'; placeholder: string; dir: 'ltr' | 'auto' }[] = [
  { key: 'ucId', placeholder: 'UC-Creates-New-Coupon', dir: 'ltr' },
  { key: 'title', placeholder: 'Vendor Creates a New Coupon', dir: 'ltr' },
  { key: 'scope', placeholder: 'Coupon', dir: 'ltr' },
  { key: 'primaryActor', placeholder: 'Vendor', dir: 'ltr' },
];

const SECTIONS: { key: 'preconditions' | 'postconditions' | 'mainScenario' | 'exceptions' | 'specialRequirements'; hint: string; rows: number }[] = [
  { key: 'preconditions', hint: 'هر شرط یک مورد.', rows: 4 },
  { key: 'postconditions', hint: 'نتیجهٔ موفق و نتیجه در صورت خطا.', rows: 3 },
  { key: 'mainScenario', hint: 'الگوریتم مسیر موفق؛ شماره‌ها را Confluence می‌گذارد. در هر قدم یک کنش Vendor یا یک پاسخ سیستم.', rows: 10 },
  { key: 'exceptions', hint: 'خطاهایی که جریان را متوقف می‌کنند.', rows: 4 },
  { key: 'specialRequirements', hint: 'قوانین بیزینسی، محدودیت‌ها، متن دقیق پیام‌ها.', rows: 5 },
];

/** Editor for one Use Case page, in the order and with the headings of the Confluence pages. */
export function UseCaseEditor({ useCase, onChange }: Props) {
  const set = <K extends keyof UseCase>(key: K, value: UseCase[K]) => onChange({ ...useCase, [key]: value });
  const setExt = (i: number, patch: Partial<Extension>) => set('extensions', useCase.extensions.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const section = (key: (typeof SECTIONS)[number]['key']) => SECTIONS.find((s) => s.key === key)!;

  const outlineField = (key: (typeof SECTIONS)[number]['key']) => {
    const s = section(key);
    return (
      <label className="field" key={key}>
        <span>
          {UC_HEADINGS[key]} <small>{s.hint}</small>
        </span>
        <textarea dir="rtl" rows={s.rows} value={useCase[key]} onChange={(e) => set(key, e.target.value)} aria-label={UC_HEADINGS[key]} />
      </label>
    );
  };

  return (
    <div className="stack uc-editor">
      <div className="uc-header">
        {HEADER.map((h) => (
          <label className="field" key={h.key}>
            <span>{UC_LABELS[h.key]}</span>
            <input dir={h.dir} value={useCase[h.key]} placeholder={h.placeholder} onChange={(e) => set(h.key, e.target.value)} />
          </label>
        ))}
      </div>
      <p className="hint">{OUTLINE_HINT}</p>
      {outlineField('preconditions')}
      {outlineField('postconditions')}
      {outlineField('mainScenario')}

      <fieldset className="extensions">
        <legend>
          {UC_HEADINGS.extensions} <small className="hint">هر مسیر جایگزین معتبر یک زیرعنوان (h3) و چند مورد</small>
        </legend>
        {useCase.extensions.length === 0 && <p className="hint">هنوز Alternative Flowای ندارد.</p>}
        {useCase.extensions.map((e, i) => (
          <div className="extension" key={e.id}>
            <div className="row-between">
              <label className="field grow">
                <span>عنوان Flow {(i + 1).toLocaleString('fa-IR')}</span>
                <input dir="rtl" value={e.title} onChange={(ev) => setExt(i, { title: ev.target.value })} placeholder="ساخت کوپن از طریق لینک پیامک" />
              </label>
              <div className="btn-group">
                <button type="button" className="btn btn-sm" disabled={i === 0} onClick={() => set('extensions', moveItem(useCase.extensions, i, i - 1))} aria-label={`بالا بردن Flow ${i + 1}`}>
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={i === useCase.extensions.length - 1}
                  onClick={() => set('extensions', moveItem(useCase.extensions, i, i + 1))}
                  aria-label={`پایین بردن Flow ${i + 1}`}
                >
                  ↓
                </button>
                <button type="button" className="btn btn-sm btn-ghost-danger" onClick={() => set('extensions', useCase.extensions.filter((_, j) => j !== i))} aria-label={`حذف Flow ${i + 1}`}>
                  حذف
                </button>
              </div>
            </div>
            <textarea dir="rtl" rows={4} value={e.body} onChange={(ev) => setExt(i, { body: ev.target.value })} aria-label={`قدم‌های Flow ${i + 1}`} />
          </div>
        ))}
        <button type="button" className="btn btn-sm" onClick={() => set('extensions', [...useCase.extensions, blankExtension()])}>
          + افزودن Alternative Flow
        </button>
      </fieldset>

      {outlineField('exceptions')}
      {outlineField('specialRequirements')}
      <label className="field">
        <span>
          {UC_HEADINGS.relatedUseCases} <small>هر خط یک UC ID؛ برای لینک: UC-Coupon-03 | https://confluence…</small>
        </span>
        <textarea dir="ltr" rows={3} value={useCase.relatedUseCases} onChange={(e) => set('relatedUseCases', e.target.value)} />
      </label>
    </div>
  );
}
