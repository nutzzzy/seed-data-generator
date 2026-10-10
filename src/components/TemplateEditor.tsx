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
        <span>Template name</span>
        <input value={template.name} onChange={(e) => onChange({ ...template, name: e.target.value })} />
      </label>

      {template.columns.length === 0 && <p className="empty">No columns yet. Add the first column of your table.</p>}

      <ol className="columns">
        {template.columns.map((col, i) => (
          <li key={col.id} className="column-card">
            <div className="column-head">
              <span className="column-num" aria-hidden="true">
                {i + 1}
              </span>
              <label className="field grow">
                <span className="sr-only">Column {i + 1} name</span>
                <input
                  value={col.name}
                  placeholder="Column name"
                  aria-label={`Column ${i + 1} name`}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={col.required} onChange={(e) => update(i, { required: e.target.checked })} />
                Required
              </label>
              <div className="btn-group">
                <button type="button" className="icon-btn" aria-label={`Move ${col.name || `column ${i + 1}`} up`} disabled={i === 0} onClick={() => setColumns(moveItem(template.columns, i, i - 1))}>
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Move ${col.name || `column ${i + 1}`} down`}
                  disabled={i === template.columns.length - 1}
                  onClick={() => setColumns(moveItem(template.columns, i, i + 1))}
                >
                  ↓
                </button>
                <button type="button" className="icon-btn danger" aria-label={`Remove ${col.name || `column ${i + 1}`}`} onClick={() => setColumns(template.columns.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            </div>
            <div className="column-body">
              <input value={col.description} placeholder="Description (what this column holds)" aria-label={`Column ${i + 1} description`} onChange={(e) => update(i, { description: e.target.value })} />
              <input value={col.expected} placeholder="Expected content, e.g. “One sentence starting with Given”" aria-label={`Column ${i + 1} expected content`} onChange={(e) => update(i, { expected: e.target.value })} />
              <details>
                <summary>Checked rules{ruleSummary(col)}</summary>
                <div className="rules-grid">
                  <label className="field">
                    <span>Allowed values <small>comma separated</small></span>
                    <input value={col.allowedValues} placeholder="High, Medium, Low" onChange={(e) => update(i, { allowedValues: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Pattern <small>regular expression</small></span>
                    <input className="mono" value={col.pattern} placeholder="^AC-\d+$" onChange={(e) => update(i, { pattern: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Max length</span>
                    <input
                      type="number"
                      min={1}
                      value={col.maxLength ?? ''}
                      onChange={(e) => update(i, { maxLength: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
                    />
                  </label>
                  <label className="field">
                    <span>Must not contain <small>comma separated</small></span>
                    <input value={col.forbidden ?? ''} placeholder="password, token" onChange={(e) => update(i, { forbidden: e.target.value })} />
                  </label>
                  <label className="check">
                    <input type="checkbox" checked={col.unique} onChange={(e) => update(i, { unique: e.target.checked })} />
                    Values must be unique
                  </label>
                </div>
              </details>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="btn" onClick={() => setColumns([...template.columns, blankColumn(`Column ${template.columns.length + 1}`)])}>
        + Add column
      </button>
    </div>
  );
}

function ruleSummary(c: ColumnDef): string {
  const n = [c.allowedValues.trim(), c.pattern.trim(), c.maxLength, c.unique, c.forbidden?.trim()].filter(Boolean).length;
  return n ? ` (${n})` : '';
}
