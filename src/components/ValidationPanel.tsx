import type { TableData } from '../lib/exporters';
import { seedChecklist, type CheckState } from '../lib/seedData';
import type { Issue } from '../lib/types';
import type { ValidationResult } from '../lib/validate';

interface Props {
  table: TableData;
  result: ValidationResult;
  notes: Issue[];
}

const ICON: Record<CheckState, string> = { ok: '✓', fail: '✗', review: '!', manual: '' };
const rowList = (rows: number[]) => `ردیف ${rows.map((r) => r + 1).join('، ')}`;

/** The guide's checklist, scored by the deterministic checks, followed by the detailed findings. */
export function ValidationPanel({ table, result, notes }: Props) {
  const { errors, warnings, manualChecks } = result;
  const items = seedChecklist(table, result);
  const failed = items.filter((i) => i.state === 'fail').length;
  const review = items.filter((i) => i.state === 'review').length;

  return (
    <section className="validation" aria-label="نتیجهٔ بررسی">
      <p className={`validation-summary ${failed ? 'bad' : 'ok'}`} role="status">
        {failed
          ? `${failed} مورد از Checklist رعایت نشده است${review ? ` و ${review} مورد نیاز به بررسی دارد` : ''}.`
          : review
            ? `خطایی پیدا نشد. ${review} مورد نیاز به بررسی دارد.`
            : 'همهٔ موارد Checklist که خودکار بررسی می‌شوند رعایت شده‌اند.'}
      </p>

      <h4>Checklist قبل از ثبت Seed Data</h4>
      <ul className="checklist">
        {items.map((item) => (
          <li key={item.label} className={`check-item state-${item.state}`}>
            {item.state === 'manual' ? (
              <label className="check">
                <input type="checkbox" /> {item.label} <small>(بررسی دستی)</small>
              </label>
            ) : (
              <>
                <span className="check-icon" aria-label={{ ok: 'رعایت شده', fail: 'رعایت نشده', review: 'نیاز به بررسی', manual: '' }[item.state]}>
                  {ICON[item.state]}
                </span>
                <span>
                  {item.label}
                  {item.rows.length > 0 && <small> — {rowList(item.rows)}</small>}
                  {item.detail && <small> — {item.detail}</small>}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      {(errors.length > 0 || warnings.length > 0) && (
        <details className="findings" open={errors.length > 0}>
          <summary>
            جزئیات: {errors.length} خطا، {warnings.length} مورد برای بررسی
          </summary>
          {errors.length > 0 && <IssueList title="خطاها" items={errors} level="error" />}
          {warnings.length > 0 && <IssueList title="برای بررسی" items={warnings} level="warning" />}
        </details>
      )}
      {notes.length > 0 && <IssueList title="نکاتی که هنگام ساخت مشخص شد" items={notes} level="warning" />}
      {manualChecks.length > 0 && (
        <details>
          <summary>قوانین استاندارد برای بررسی دستی ({manualChecks.length})</summary>
          <ul className="checklist">
            {manualChecks.map((c, i) => (
              <li key={i}>
                <label className="check">
                  <input type="checkbox" /> <span dir="auto">{c}</span>
                </label>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function IssueList({ title, items, level }: { title: string; items: Issue[]; level: string }) {
  return (
    <div>
      <h4>{title}</h4>
      <ul className={`issues issues-${level}`}>
        {items.map((i, n) => (
          <li key={n} className={`issue-${i.level}`} dir="auto">
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
