import { blankColumn, blankRow, moveItem } from '../lib/model';
import type { GeneratedTable, Issue } from '../lib/types';
import { useDialogs } from './Dialogs';

interface Props {
  table: GeneratedTable;
  issues: Issue[];
  onChange: (t: GeneratedTable) => void;
}

/** Editable grid. Changes affect only this table, never the saved template. */
export function TableEditor({ table, issues, onChange }: Props) {
  const { confirm } = useDialogs();
  const levelAt = cellLevels(issues);

  const setCell = (rowId: string, colId: string, value: string) =>
    onChange({ ...table, rows: table.rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r)) });

  const renameColumn = (colId: string, name: string) =>
    onChange({ ...table, columns: table.columns.map((c) => (c.id === colId ? { ...c, name } : c)) });

  const removeColumn = async (colId: string) => {
    const col = table.columns.find((c) => c.id === colId)!;
    const hasData = table.rows.some((r) => (r.cells[colId] ?? '').trim());
    if (hasData) {
      const ok = await confirm({
        title: 'حذف ستون؟',
        message: `مقدارهای ستون «${col.name}» از این جدول حذف می‌شوند. ساختار ذخیره‌شده تغییر نمی‌کند.`,
        confirmLabel: 'حذف ستون',
        danger: true,
      });
      if (!ok) return;
    }
    onChange({
      ...table,
      columns: table.columns.filter((c) => c.id !== colId),
      rows: table.rows.map((r) => {
        const cells = { ...r.cells };
        delete cells[colId];
        return { ...r, cells };
      }),
    });
  };

  const addColumn = () => {
    const col = blankColumn(`ستون جدید ${table.columns.length + 1}`);
    onChange({ ...table, columns: [...table.columns, col], rows: table.rows.map((r) => ({ ...r, cells: { ...r.cells, [col.id]: '' } })) });
  };

  const addRow = () => onChange({ ...table, rows: [...table.rows, blankRow(table.columns)] });
  const deleteRow = (rowId: string) => onChange({ ...table, rows: table.rows.filter((r) => r.id !== rowId) });
  const moveRow = (from: number, to: number) => onChange({ ...table, rows: moveItem(table.rows, from, to) });
  const moveColumn = (from: number, to: number) => onChange({ ...table, columns: moveItem(table.columns, from, to) });

  return (
    <div className="table-wrap" dir="ltr">
      <table className="grid">
        <thead>
          <tr>
            <th className="row-num" scope="col">
              #
            </th>
            {table.columns.map((col, i) => (
              <th key={col.id} scope="col" className={levelAt(undefined, col.id)}>
                <div className="th-inner">
                  <input value={col.name} aria-label={`عنوان ستون ${i + 1}`} onChange={(e) => renameColumn(col.id, e.target.value)} />
                  <div className="btn-group">
                    <button type="button" className="icon-btn" aria-label={`انتقال ستون ${col.name} به چپ`} disabled={i === 0} onClick={() => moveColumn(i, i - 1)}>
                      ←
                    </button>
                    <button type="button" className="icon-btn" aria-label={`انتقال ستون ${col.name} به راست`} disabled={i === table.columns.length - 1} onClick={() => moveColumn(i, i + 1)}>
                      →
                    </button>
                    <button type="button" className="icon-btn danger" aria-label={`حذف ستون ${col.name}`} onClick={() => removeColumn(col.id)}>
                      ×
                    </button>
                  </div>
                </div>
              </th>
            ))}
            <th className="row-actions" scope="col">
              <button type="button" className="btn btn-sm" onClick={addColumn}>
                + ستون
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.length === 0 && (
            <tr>
              <td colSpan={table.columns.length + 2} className="empty">
                ردیفی وجود ندارد. یک ردیف اضافه کنید یا Seed Data را دوباره بسازید.
              </td>
            </tr>
          )}
          {table.rows.map((row, r) => (
            <tr key={row.id}>
              <th scope="row" className="row-num">
                {r + 1}
              </th>
              {table.columns.map((col) => (
                <td key={col.id} className={levelAt(r, col.id)}>
                  <textarea
                    rows={2}
                    value={row.cells[col.id] ?? ''}
                    dir="auto"
                    aria-label={`ردیف ${r + 1}، ${col.name}`}
                    onChange={(e) => setCell(row.id, col.id, e.target.value)}
                  />
                </td>
              ))}
              <td className="row-actions">
                <div className="btn-group">
                  <button type="button" className="icon-btn" aria-label={`انتقال ردیف ${r + 1} به بالا`} disabled={r === 0} onClick={() => moveRow(r, r - 1)}>
                    ↑
                  </button>
                  <button type="button" className="icon-btn" aria-label={`انتقال ردیف ${r + 1} به پایین`} disabled={r === table.rows.length - 1} onClick={() => moveRow(r, r + 1)}>
                    ↓
                  </button>
                  <button type="button" className="icon-btn danger" aria-label={`حذف ردیف ${r + 1}`} onClick={() => deleteRow(row.id)}>
                    ×
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="btn btn-sm add-row" onClick={addRow}>
        + افزودن ردیف
      </button>
    </div>
  );
}

/** Highest-severity class for a cell (row + column) or a header (column only). */
function cellLevels(issues: Issue[]) {
  const map = new Map<string, string>();
  const rank = { error: 3, warning: 2, info: 1 } as const;
  for (const i of issues) {
    if (!i.columnId) continue;
    const key = `${i.row ?? 'h'}:${i.columnId}`;
    const current = map.get(key);
    if (!current || rank[i.level] > rank[current as keyof typeof rank]) map.set(key, i.level);
  }
  return (row: number | undefined, colId: string) => {
    const level = map.get(`${row ?? 'h'}:${colId}`);
    return level ? `has-${level}` : undefined;
  };
}
