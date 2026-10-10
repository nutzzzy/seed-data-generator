import type { Issue } from '../lib/types';
import type { ValidationResult } from '../lib/validate';

interface Props {
  result: ValidationResult;
  notes: Issue[];
}

export function ValidationPanel({ result, notes }: Props) {
  const { errors, warnings, manualChecks } = result;
  return (
    <section className="validation" aria-label="Validation results">
      <p className={`validation-summary ${result.ok ? 'ok' : 'bad'}`} role="status">
        {result.ok
          ? warnings.length
            ? `No errors. ${warnings.length} item${warnings.length === 1 ? '' : 's'} to review.`
            : 'No errors or warnings found by the automatic checks.'
          : `${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} item${warnings.length === 1 ? '' : 's'} to review.`}
      </p>
      {errors.length > 0 && <IssueList title="Errors" items={errors} level="error" />}
      {warnings.length > 0 && <IssueList title="To review" items={warnings} level="warning" />}
      {notes.length > 0 && <IssueList title="Flagged during generation" items={notes} level="warning" />}
      {manualChecks.length > 0 && (
        <div>
          <h4>Check manually against the standard</h4>
          <p className="hint">These rules are written in plain language, so the app can’t check them automatically.</p>
          <ul className="checklist">
            {manualChecks.map((c, i) => (
              <li key={i}>
                <label className="check">
                  <input type="checkbox" /> {c}
                </label>
              </li>
            ))}
          </ul>
        </div>
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
          <li key={n} className={`issue-${i.level}`}>
            {i.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
