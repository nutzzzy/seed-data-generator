import type { UcIssue } from '../types';

const LEVEL = { error: 'خطا', warning: 'بررسی', info: 'پیشنهاد' } as const;
const fa = (n: number) => n.toLocaleString('fa-IR');

/** One line when everything is fine; otherwise the counts, with the list open when there are errors. */
export function UcIssuesPanel({ issues }: { issues: UcIssue[] }) {
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;
  if (!issues.length) {
    return (
      <p className="issues-line ok" role="status">
        ✓ قوانین Confluence رعایت شده‌اند.
      </p>
    );
  }
  return (
    <details className={`issues-box ${errors ? 'bad' : 'warn'}`} open={errors > 0}>
      <summary role="status">
        {errors ? `${fa(errors)} خطا` : '✓ بدون خطا'}
        {warnings > 0 && ` · ${fa(warnings)} مورد برای بررسی`}
        {issues.length - errors - warnings > 0 && ` · ${fa(issues.length - errors - warnings)} پیشنهاد`}
      </summary>
      <ul className="issues">
        {issues.map((i, n) => (
          <li key={n} className={`issue-${i.level}`}>
            <b>{LEVEL[i.level]}</b>
            {i.where && <small> · {i.where}</small>}: {i.message}
          </li>
        ))}
      </ul>
    </details>
  );
}
