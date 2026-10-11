import { useEffect, useState } from 'react';
import { renderMermaid } from '../render';

/** Live preview of the Mermaid source; syntax errors are shown instead of the diagram. */
export function MermaidPreview({ source }: { source: string }) {
  const [state, setState] = useState<{ svg?: string; error?: string; busy: boolean }>({ busy: true });

  useEffect(() => {
    let cancelled = false;
    if (source.trim().split('\n').filter((l) => l.trim()).length < 2) {
      setState({ busy: false });
      return;
    }
    setState((s) => ({ ...s, busy: true }));
    const t = setTimeout(() => {
      renderMermaid(source)
        .then((svg) => !cancelled && setState({ svg, busy: false }))
        .catch((err: unknown) => !cancelled && setState({ error: err instanceof Error ? err.message : String(err), busy: false }));
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [source]);

  if (state.error) {
    return (
      <div className="mermaid-preview error" role="alert">
        <strong>خطای Syntax در Mermaid</strong>
        <pre dir="ltr">{state.error}</pre>
      </div>
    );
  }
  if (!state.svg) return <div className="mermaid-preview empty">{state.busy ? 'در حال رسم…' : 'نمودار هنوز گره‌ای ندارد.'}</div>;
  return <div className="mermaid-preview" aria-label="پیش‌نمایش نمودار" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
