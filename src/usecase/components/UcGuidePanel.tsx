import { CONFLUENCE_REFERENCE_URL, GUIDE_POINTS } from '../rules';

/** Short version of the Use Case rules (full text: .claude/skills/snapp-usecase/SKILL.md). */
export function UcGuidePanel() {
  return (
    <details className="card guide" open>
      <summary>
        <strong>راهنمای Use Case و فلوچارت</strong>
        <span className="hint"> — قوانین صفحهٔ Partner Use Cases by Domain در Confluence</span>
      </summary>
      <div className="guide-body">
        <p className="hint">
          مرجع:{' '}
          <a href={CONFLUENCE_REFERENCE_URL} target="_blank" rel="noreferrer">
            Partner Use Cases by Domain
          </a>{' '}
          و صفحات Use Case زیر آن. ساختار: Domain → Service → Feature → Use Case.
        </p>
        <div className="guide-grid">
          <section>
            <h4>صفحهٔ Use Case (الگوریتم)</h4>
            <ul>
              {GUIDE_POINTS.useCase.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
          <section>
            <h4>بخش نمودار (فلوچارت Mermaid)</h4>
            <ul>
              {GUIDE_POINTS.diagram.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </details>
  );
}
