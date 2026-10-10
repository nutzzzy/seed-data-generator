import { blankColumn, moveItem } from '../lib/model';
import type { ColumnDef, Template } from '../lib/types';

interface Props {
  template: Template;
  onChange: (t: Template) => void;
}

export function TemplateEditor({ template, onChange }: Props) {
  const setColumns = (columns: ColumnDef[]) => onChange({ ...template, columns });
  const update = (i: number, patch: Partial<ColumnDef>) =>
    setColumns(template.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="stack">
      <label className="field">
        <span>نام ساختار جدول</span>
        <input value={template.name} onChange={(e) => onChange({ ...template, name: e.target.value })} />
      </label>

      {template.columns.length === 0 && <p className="empty">هنوز ستونی وجود ندارد. اولین ستون جدول را اضافه کنید.</p>}

      <ol className="columns">
        {template.columns.map((col, i) => (
          <li key={col.id} className="column-card">
            <div className="column-head">
              <span className="column-num" aria-hidden="true">
                {i + 1}
              </span>
              <label className="field grow">
                <span className="sr-only">نام ستون {i + 1}</span>
                <input
                  value={col.name}
                  placeholder="نام ستون"
                  aria-label={`نام ستون ${i + 1}`}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={col.required} onChange={(e) => update(i, { required: e.target.checked })} />
                اجباری
              </label>
              <div className="btn-group">
                <button type="button" className="icon-btn" aria-label={`انتقال ${col.name || `ستون ${i + 1}`} به بالا`} disabled={i === 0} onClick={() => setColumns(moveItem(template.columns, i, i - 1))}>
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`انتقال ${col.name || `ستون ${i + 1}`} به پایین`}
                  disabled={i === template.columns.length - 1}
                  onClick={() => setColumns(moveItem(template.columns, i, i + 1))}
                >
                  ↓
                </button>
                <button type="button" className="icon-btn danger" aria-label={`حذف ${col.name || `ستون ${i + 1}`}`} onClick={() => setColumns(template.columns.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            </div>
            <div className="column-body">
              <input value={col.description} placeholder="توضیح (این ستون چه چیزی را نگه می‌دارد)" aria-label={`توضیح ستون ${i + 1}`} onChange={(e) => update(i, { description: e.target.value })} />
              <input value={col.expected} placeholder="محتوای موردانتظار، مثلاً Numbered steps" aria-label={`محتوای موردانتظار ستون ${i + 1}`} onChange={(e) => update(i, { expected: e.target.value })} />
              <details>
                <summary>قوانین بررسی خودکار{ruleSummary(col)}</summary>
                <div className="rules-grid">
                  <label className="field">
                    <span>مقادیر مجاز <small>با کاما جدا کنید</small></span>
                    <input value={col.allowedValues} placeholder="High, Medium, Low" onChange={(e) => update(i, { allowedValues: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>الگو <small>Regex</small></span>
                    <input className="mono" dir="ltr" value={col.pattern} placeholder="^AC-\d+$" onChange={(e) => update(i, { pattern: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>حداکثر طول</span>
                    <input
                      type="number"
                      min={1}
                      value={col.maxLength ?? ''}
                      onChange={(e) => update(i, { maxLength: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
                    />
                  </label>
                  <label className="field">
                    <span>نباید شامل باشد <small>با کاما جدا کنید</small></span>
                    <input value={col.forbidden ?? ''} placeholder="password, token" onChange={(e) => update(i, { forbidden: e.target.value })} />
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={col.unique} onChange={(e) => update(i, { unique: e.target.checked })} />
                    مقدار تکراری مجاز نیست
                  </label>
                </div>
              </details>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="btn" onClick={() => setColumns([...template.columns, blankColumn(`ستون ${template.columns.length + 1}`)])}>
        + افزودن ستون
      </button>
    </div>
  );
}

function ruleSummary(c: ColumnDef): string {
  const n = [c.allowedValues.trim(), c.pattern.trim(), c.maxLength, c.unique, c.forbidden?.trim()].filter(Boolean).length;
  return n ? ` (${n})` : '';
}
