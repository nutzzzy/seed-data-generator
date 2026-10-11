import { figureCaption, imageFileOf } from '../model';
import type { DiagramSection } from '../types';
import { MermaidPreview } from './MermaidPreview';

interface Props {
  section: DiagramSection;
  number: number;
  onChange: (s: DiagramSection) => void;
  /** When set, the section number can be edited (a use case's flowchart has no fixed place on the page). */
  onNumberChange?: (n: number) => void;
}

/** One numbered section of the diagram page: heading, description, Mermaid source with live preview. */
export function DiagramEditor({ section, number, onChange, onNumberChange }: Props) {
  const set = <K extends keyof DiagramSection>(key: K, value: DiagramSection[K]) => onChange({ ...section, [key]: value });
  return (
    <div className="diagram-editor">
      <div className="diagram-head">
        <label className="field">
          <span>عنوان (Domain — Service)</span>
          <input dir="ltr" value={section.heading} onChange={(e) => set('heading', e.target.value)} placeholder="Coupon — Coupon Service" />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea dir="auto" rows={2} value={section.description} onChange={(e) => set('description', e.target.value)} placeholder="چه چیزی را پوشش می‌دهد، از کجا وارد می‌شود و به کدام Domain می‌رود." />
        </label>
      </div>
      <div className="diagram-grid">
        <label className="field">
          <span>کد Mermaid</span>
          <textarea
            className="mono code-area"
            dir="ltr"
            spellCheck={false}
            rows={18}
            value={section.mermaid}
            onChange={(e) => set('mermaid', e.target.value)}
            aria-label={`کد Mermaid بخش ${number}`}
          />
        </label>
        <div className="field">
          <span>
            پیش‌نمایش <small dir="ltr">{figureCaption(number, section.heading || '…')}</small>
          </span>
          <MermaidPreview source={section.mermaid} />
        </div>
      </div>
      <details className="diagram-settings">
        <summary>
          تصویر در Confluence: <code dir="ltr">{imageFileOf(section, number)}</code>
          {onNumberChange && <> · شمارهٔ بخش: {number}</>}
        </summary>
        <div className="row-between">
          <label className="field grow">
            <span>نام فایل تصویر (خالی = پیشنهاد خودکار)</span>
            <input dir="ltr" value={section.imageFile} placeholder={imageFileOf(section, number)} onChange={(e) => set('imageFile', e.target.value)} />
          </label>
          {onNumberChange && (
            <label className="field narrow">
              <span>شمارهٔ بخش در صفحهٔ نمودارها</span>
              <input type="number" min={1} value={number} onChange={(e) => onNumberChange(Math.max(1, Number(e.target.value) || 1))} />
            </label>
          )}
        </div>
      </details>
    </div>
  );
}
