import { useEffect, useState } from 'react';
import { copyRich, copyText, downloadFile } from '../../lib/clipboard';
import { safeFileName } from '../../lib/exporters';
import { useDialogs } from '../../components/Dialogs';
import { useToast } from '../../components/Toasts';
import { htmlToText, overviewHtml, sectionHtml, sectionMarkdown, sectionWiki, useCaseHtml, useCaseMarkdown, useCaseWiki } from '../confluenceExport';
import { publishConfluencePage, type PublishRequest } from '../confluenceClient';
import { imageFileOf } from '../model';
import { dataUrlToBase64, mermaidToPng, renderMermaid } from '../render';
import type { DiagramSection, UcDoc } from '../types';

interface Props {
  doc: UcDoc;
  errors: number;
  /** For a diagram page: the section open in the editor, offered as "this section". */
  sectionIndex: number;
  /** What to export first: the whole page or the section/flowchart being edited. */
  initialTarget?: Target;
  onPublished: (version: number) => void;
  onClose: () => void;
}

type Target = 'page' | 'section';

/** Everything needed to get the document into Confluence, in one place: copy, image, publish, and other formats. */
export function ExportDialog({ doc, errors, sectionIndex, initialTarget = 'page', onPublished, onClose }: Props) {
  const notify = useToast();
  const { showText, confirm } = useDialogs();
  const [busy, setBusy] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>(initialTarget);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const section: { section: DiagramSection; number: number } | null =
    doc.kind === 'usecase'
      ? { section: doc.flowchart, number: doc.flowchartNumber }
      : doc.sections[sectionIndex]
        ? { section: doc.sections[sectionIndex], number: sectionIndex + 1 }
        : null;
  const onSection = target === 'section' && section;
  const pageLabel = doc.kind === 'usecase' ? 'صفحهٔ Use Case' : 'کل صفحه';
  const sectionLabel = doc.kind === 'usecase' ? 'فلوچارت' : section ? `بخش ${section.number}` : 'بخش';

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    try {
      await task();
    } catch (err) {
      notify('error', `${label}: ${err instanceof Error ? err.message : 'ناموفق بود.'}`);
    } finally {
      setBusy(null);
    }
  };
  const copied = async (label: string, ok: boolean, text: string) => {
    if (ok) notify('success', `${label} کپی شد.`);
    else await showText({ title: label, message: 'مرورگر اجازهٔ دسترسی به Clipboard را نداد. متن زیر را کپی کنید.', text });
  };
  const copyHtml = async (label: string, html: string) => copied(label, await copyRich(html, htmlToText(html)), html);
  const copyPlain = async (label: string, text: string) => copied(label, await copyText(text), text);

  // ---- Main actions ----------------------------------------------------------------------------

  const copyForConfluence = () =>
    run('کپی', async () => {
      if (onSection) {
        let imageDataUrl: string | undefined;
        try {
          imageDataUrl = await mermaidToPng(onSection.section.mermaid);
        } catch {
          /* still useful without the picture */
        }
        return copyHtml(sectionLabel, sectionHtml(onSection.section, onSection.number, 'paste', { imageDataUrl }));
      }
      return copyHtml(pageLabel, doc.kind === 'usecase' ? useCaseHtml(doc.useCase, 'paste') : overviewHtml(doc, 'paste'));
    });

  const images = doc.kind === 'usecase' || onSection ? [section!] : doc.sections.map((s, i) => ({ section: s, number: i + 1 }));
  const downloadImages = () =>
    run('دانلود تصویر', async () => {
      for (const { section: s, number } of images) {
        const a = document.createElement('a');
        a.href = await mermaidToPng(s.mermaid);
        a.download = imageFileOf(s, number);
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      notify('success', images.length === 1 ? `${imageFileOf(images[0].section, images[0].number)} دانلود شد.` : `${images.length} تصویر دانلود شد.`);
    });

  const canPublish = doc.source?.via === 'link' && !!doc.source.pageId && doc.source.version !== undefined;
  const publish = () =>
    run('انتشار', async () => {
      if (!doc.source?.pageId || doc.source.version === undefined) return;
      const changed = doc.kind === 'overview' ? doc.sections.map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s.mermaid !== s.publishedMermaid) : [];
      const ok = await confirm({
        title: 'صفحه در Confluence به‌روز شود؟',
        message:
          doc.kind === 'usecase'
            ? `محتوای «${doc.source.title}» با همین Use Case جایگزین می‌شود.`
            : `بخش‌های نمودار «${doc.source.title}» جایگزین می‌شوند و مقدمهٔ صفحه دست نمی‌خورد${changed.length ? `؛ تصویر ${changed.length} نمودار تغییرکرده هم آپلود می‌شود` : ''}.`,
        confirmLabel: 'انتشار',
      });
      if (!ok) return;
      const attachments: PublishRequest['attachments'] = [];
      for (const { s, n } of changed) attachments.push({ fileName: imageFileOf(s, n), base64: dataUrlToBase64(await mermaidToPng(s.mermaid)) });
      const storage = doc.kind === 'usecase' ? useCaseHtml(doc.useCase, 'storage') : overviewHtml(doc, 'storage');
      const result = await publishConfluencePage({ pageId: doc.source.pageId, version: doc.source.version, storage, attachments });
      onPublished(result.version);
      notify('success', `صفحه در Confluence به‌روز شد (نسخهٔ ${result.version}).`);
    });

  // ---- Other formats -----------------------------------------------------------------------------

  const formats: { label: string; run: () => void }[] = onSection
    ? [
        { label: 'Storage Format (XHTML)', run: () => copyPlain('Storage Format', sectionHtml(onSection.section, onSection.number, 'storage')) },
        { label: 'کد Mermaid', run: () => copyPlain('کد Mermaid', onSection.section.mermaid) },
        { label: 'Wiki Markup', run: () => copyPlain('Wiki Markup', sectionWiki(onSection.section, onSection.number)) },
        { label: 'Markdown', run: () => copyPlain('Markdown', sectionMarkdown(onSection.section, onSection.number)) },
        {
          label: 'دانلود SVG',
          run: () =>
            run('دانلود SVG', async () =>
              downloadFile(imageFileOf(onSection.section, onSection.number).replace(/\.\w+$/, '.svg'), await renderMermaid(onSection.section.mermaid), 'image/svg+xml'),
            ),
        },
      ]
    : doc.kind === 'usecase'
      ? [
          { label: 'Storage Format (XHTML)', run: () => copyPlain('Storage Format', useCaseHtml(doc.useCase, 'storage')) },
          { label: 'Wiki Markup', run: () => copyPlain('Wiki Markup', useCaseWiki(doc.useCase)) },
          { label: 'Markdown', run: () => copyPlain('Markdown', useCaseMarkdown(doc.useCase)) },
        ]
      : [
          { label: 'Storage Format (XHTML)', run: () => copyPlain('Storage Format', overviewHtml(doc, 'storage')) },
          { label: 'Wiki Markup', run: () => copyPlain('Wiki Markup', doc.sections.map((s, i) => sectionWiki(s, i + 1)).join('\n\n')) },
          {
            label: 'دانلود فایل Storage',
            run: () => downloadFile(safeFileName(doc.name, 'xhtml'), overviewHtml(doc, 'storage'), 'application/xhtml+xml;charset=utf-8'),
          },
        ];

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="dialog wide export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <div className="row-between">
          <h2 id="export-title">خروجی برای Confluence</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="بستن">
            ✕
          </button>
        </div>

        {section && (
          <div className="segmented" role="group" aria-label="چه چیزی">
            <button type="button" aria-pressed={target === 'page'} onClick={() => setTarget('page')}>
              {pageLabel}
            </button>
            <button type="button" aria-pressed={target === 'section'} onClick={() => setTarget('section')}>
              {sectionLabel}
            </button>
          </div>
        )}
        {errors > 0 && <p className="hint warn">{errors.toLocaleString('fa-IR')} خطای قوانین هنوز باقی است؛ بهتر است اول رفع شود.</p>}

        <div className="export-actions">
          <button type="button" className="export-option primary" onClick={copyForConfluence} disabled={!!busy}>
            <strong>کپی برای Confluence</strong>
            <span>صفحه را در Confluence ویرایش کنید و Paste کنید (Ctrl+V). ساختار و عنوان‌ها مثل صفحات فعلی است.</span>
          </button>
          {(doc.kind === 'overview' || target === 'section') && (
            <button type="button" className="export-option" onClick={downloadImages} disabled={!!busy}>
              <strong>دانلود تصویر نمودار (PNG)</strong>
              <span>
                {images.length === 1 ? (
                  <>
                    با نام <bdi dir="ltr">{imageFileOf(images[0].section, images[0].number)}</bdi>
                  </>
                ) : (
                  `${images.length} تصویر`
                )}
                ؛ در صفحه Attach کنید تا Rendered Diagram به‌روز شود.
              </span>
            </button>
          )}
          {canPublish && (
            <button type="button" className="export-option" onClick={publish} disabled={!!busy}>
              <strong>{busy === 'انتشار' ? 'در حال انتشار…' : 'انتشار مستقیم در همان صفحه'}</strong>
              <span>
                «{doc.source!.title}» · نسخهٔ {doc.source!.version}. اگر صفحه بعد از ایمپورت تغییر کرده باشد، چیزی نوشته نمی‌شود.
              </span>
            </button>
          )}
        </div>

        <details className="more-formats">
          <summary>فرمت‌های دیگر</summary>
          <div className="btn-group">
            {formats.map((f) => (
              <button key={f.label} type="button" className="btn btn-sm" onClick={f.run} disabled={!!busy}>
                {f.label}
              </button>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
