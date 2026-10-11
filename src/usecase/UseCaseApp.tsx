import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogs } from '../components/Dialogs';
import { SettingsDialog } from '../components/SettingsDialog';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { useToast } from '../components/Toasts';
import { GenerationError, type AiTransport } from '../lib/generate';
import { newId, nowIso } from '../lib/ids';
import { providerLabel } from '../lib/providerLabel';
import { confluenceStatus, fetchConfluencePage, type ConfluenceStatus } from './confluenceClient';
import { ImportError, parsePage, type ParsedPage } from './confluenceParse';
import { generateFlowchart, generateUseCase } from './generate';
import { flowchartFromUseCase } from './mermaid';
import { blankSection, moveItem, newOverviewDoc, newUseCaseDoc, touch } from './model';
import { CONFLUENCE_REFERENCE_URL } from './rules';
import { loadUcWorkspace, saveUcWorkspace } from './storage';
import type { ConfluenceSource, DiagramSection, OverviewDoc, UcDoc, UcIssue, UcWorkspace, UseCaseDoc } from './types';
import { validateDoc, validateSection } from './validate';
import { DiagramEditor } from './components/DiagramEditor';
import { ExportDialog } from './components/ExportDialog';
import { UcGuidePanel } from './components/UcGuidePanel';
import { UcIssuesPanel } from './components/UcIssuesPanel';
import { UseCaseEditor } from './components/UseCaseEditor';

interface Props {
  transport?: AiTransport;
  modeSwitch?: React.ReactNode;
}

type StartTab = 'import' | 'ai' | 'empty';
type UcTab = 'usecase' | 'flowchart';

const fa = (n: number) => n.toLocaleString('fa-IR');
const isLink = (s: string) => /^https?:\/\/\S+$/.test(s.trim());
const hasDiagram = (s: DiagramSection) => s.mermaid.trim().split('\n').filter((l) => l.trim()).length > 1;
const errorCount = (list: UcIssue[]) => list.filter((i) => i.level === 'error').length;

/** The "snapp usecase!" section: a home screen to start from, then one document at a time. */
export function UseCaseApp({ transport, modeSwitch }: Props) {
  const [loaded] = useState(() => loadUcWorkspace());
  const [ws, setWs] = useState<UcWorkspace>(loaded.workspace);
  const [openId, setOpenId] = useState<string | null>(null);
  const [startTab, setStartTab] = useState<StartTab>('import');
  const [source, setSource] = useState<{ content: string; preview: string }>({ content: '', preview: '' });
  const [ucTab, setUcTab] = useState<UcTab>('usecase');
  const [sectionIndex, setSectionIndex] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [busy, setBusy] = useState<{ label: string; controller: AbortController } | null>(null);
  const [status, setStatus] = useState<ConfluenceStatus | null>(null);
  const [aiIssues, setAiIssues] = useState<string[]>([]);
  const { confirm, prompt } = useDialogs();
  const notify = useToast();
  const storageError = useRef<string | null>(null);

  useEffect(() => {
    if (loaded.warning) notify('error', loaded.warning);
  }, [loaded, notify]);

  useEffect(() => {
    const t = setTimeout(() => {
      const err = saveUcWorkspace(ws);
      if (err && err !== storageError.current) notify('error', err);
      storageError.current = err;
    }, 250);
    return () => clearTimeout(t);
  }, [ws, notify]);

  useEffect(() => {
    confluenceStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const update = (patch: Partial<UcWorkspace> | ((w: UcWorkspace) => Partial<UcWorkspace>)) => setWs((w) => ({ ...w, ...(typeof patch === 'function' ? patch(w) : patch) }));
  const doc = ws.docs.find((d) => d.id === openId) ?? null;
  const setDoc = (next: UcDoc) => update((w) => ({ docs: w.docs.map((d) => (d.id === next.id ? touch(next) : d)) }));
  const open = (id: string, tab: UcTab = 'usecase') => {
    setOpenId(id);
    setUcTab(tab);
    setSectionIndex(0);
    update({ activeId: id });
    window.scrollTo?.({ top: 0 });
  };
  const addDoc = (d: UcDoc) => {
    update((w) => ({ docs: [d, ...w.docs] }));
    open(d.id);
  };
  const issues = useMemo(() => (doc ? validateDoc(doc, ws.docs) : []), [doc, ws.docs]);

  const run = async (label: string, task: (signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController();
    setBusy({ label, controller });
    try {
      await task(controller.signal);
    } catch (err) {
      if (controller.signal.aborted) notify('info', 'لغو شد. چیزی تغییر نکرد.');
      else notify('error', err instanceof Error ? err.message : `${label} ناموفق بود.`);
    } finally {
      setBusy(null);
    }
  };

  // ---- Start: import, AI, empty ---------------------------------------------------------------------

  const docFromParsed = (parsed: ParsedPage, src: ConfluenceSource): UcDoc => {
    const name = src.title || parsed.title || (parsed.kind === 'usecase' ? parsed.useCase!.title : 'Partner Use Cases by Domain') || 'سند ایمپورت‌شده';
    if (parsed.kind === 'usecase') return { ...newUseCaseDoc(name), source: src, useCase: parsed.useCase! };
    const sections = parsed.sections!.map((s) => ({ ...s, publishedMermaid: src.via === 'link' ? s.mermaid : undefined }));
    return { ...newOverviewDoc(name), source: src, sections, intro: parsed.intro ?? '' };
  };

  const importSource = () =>
    run('ایمپورت', async () => {
      const text = source.content.trim();
      if (!text) throw new ImportError('لینک صفحه یا محتوای آن را وارد کنید.');
      let d: UcDoc;
      if (isLink(text)) {
        const page = await fetchConfluencePage(text);
        d = docFromParsed(parsePage(page.storage, { storage: true }), {
          url: page.webUrl,
          via: 'link',
          pageId: page.id,
          title: page.title,
          spaceKey: page.spaceKey,
          version: page.version,
          importedAt: nowIso(),
        });
        const same = ws.docs.find((x) => x.source?.pageId === page.id && x.kind === d.kind);
        if (
          same &&
          (await confirm({
            title: 'این صفحه قبلاً ایمپورت شده است',
            message: `«${same.name}» با نسخهٔ فعلی Confluence جایگزین شود؟ تغییرات منتشرنشده‌اش از بین می‌رود.`,
            confirmLabel: 'جایگزینی',
            cancelLabel: 'سند جدید',
          }))
        ) {
          const replaced = { ...d, id: same.id };
          update((w) => ({ docs: w.docs.map((x) => (x.id === same.id ? replaced : x)) }));
          open(same.id);
        } else addDoc(d);
      } else {
        d = docFromParsed(parsePage(source.content), { url: '', via: 'paste', importedAt: nowIso() });
        addDoc(d);
      }
      setSource({ content: '', preview: '' });
      setAiIssues([]);
      notify('success', d.kind === 'usecase' ? `Use Case «${d.useCase.ucId || d.name}» ایمپورت شد.` : `صفحهٔ نمودارها با ${fa(d.sections.length)} بخش ایمپورت شد.`);
    });

  const generate = () =>
    run('ساخت با AI', async (signal) => {
      if (!ws.input.trim()) throw new GenerationError('ابتدا نیازمندی‌ها یا توضیحات Use Case را وارد کنید.');
      const result = await generateUseCase(ws.input, { settings: ws.settings, signal, transport });
      addDoc(newUseCaseDoc(result.useCase.title || result.useCase.ucId || 'Use Case جدید', result.useCase, { ...blankSection(), ...result.flowchart }));
      setAiIssues(result.issues);
      notify('success', `Use Case ${result.useCase.ucId ? `«${result.useCase.ucId}» ` : ''}و فلوچارت آن ساخته شد.`);
    });

  // ---- Document actions ------------------------------------------------------------------------------

  const renameDoc = async () => {
    if (!doc) return;
    const name = await prompt({ title: 'تغییر نام', label: 'نام جدید', initialValue: doc.name, confirmLabel: 'تغییر نام' });
    if (name) setDoc({ ...doc, name });
  };
  const duplicateDoc = (d: UcDoc) => {
    addDoc({ ...structuredClone(d), id: newId(d.kind === 'usecase' ? 'uc' : 'ov'), name: `${d.name} (کپی)`, source: d.source && { ...d.source, via: 'paste' as const } });
  };
  const deleteDoc = async (d: UcDoc) => {
    if (!(await confirm({ title: 'سند حذف شود؟', message: `«${d.name}» از این برنامه حذف می‌شود. صفحهٔ Confluence تغییری نمی‌کند.`, confirmLabel: 'حذف', danger: true }))) return;
    update((w) => ({ docs: w.docs.filter((x) => x.id !== d.id), activeId: null }));
    if (openId === d.id) setOpenId(null);
  };

  const drawOffline = async (d: UseCaseDoc) => {
    if (hasDiagram(d.flowchart) && !(await confirm({ title: 'فلوچارت فعلی جایگزین شود؟', message: 'کد Mermaid فعلی با پیش‌نویس ساخته‌شده از الگوریتم جایگزین می‌شود.', confirmLabel: 'جایگزینی' }))) return;
    setDoc({ ...d, flowchart: { ...d.flowchart, mermaid: flowchartFromUseCase(d.useCase) } });
    notify('success', 'پیش‌نویس فلوچارت از روی الگوریتم ساخته شد. برچسب‌ها را بازبینی کنید.');
  };
  const drawAi = (d: UseCaseDoc) =>
    run('رسم با AI', async (signal) => {
      const { flowchart, issues: found } = await generateFlowchart(d.useCase, d.flowchart, { settings: ws.settings, signal, transport });
      setDoc({ ...d, flowchart: { ...d.flowchart, ...flowchart, heading: flowchart.heading || d.flowchart.heading } });
      setAiIssues(found);
      notify('success', 'فلوچارت با AI به‌روز شد.');
    });

  const onPublished = (version: number) => {
    if (!doc?.source) return;
    const src = { ...doc.source, version };
    if (doc.kind === 'overview') setDoc({ ...doc, source: src, sections: doc.sections.map((s) => ({ ...s, publishedMermaid: s.mermaid })) });
    else setDoc({ ...doc, source: src });
  };

  // ---- Views -----------------------------------------------------------------------------------------

  const busyBar = busy && (
    <div className="busy-bar" role="status">
      <span className="spinner" aria-hidden="true" /> {busy.label}…
      <button type="button" className="btn btn-sm" onClick={() => busy.controller.abort()}>
        لغو
      </button>
    </div>
  );

  const home = (
    <main>
      <section className="card start" aria-labelledby="uc-start">
        <h2 id="uc-start">شروع</h2>
        <div className="segmented" role="tablist" aria-label="روش شروع">
          {(
            [
              ['import', 'ایمپورت از Confluence'],
              ['ai', 'ساخت با AI'],
              ['empty', 'سند خالی'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={startTab === id} onClick={() => setStartTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {startTab === 'import' && (
          <div className="stack">
            <textarea
              className="input-area"
              dir="auto"
              rows={4}
              value={source.preview}
              aria-label="لینک یا محتوای صفحهٔ Confluence"
              placeholder={`لینک صفحه، مثل ${CONFLUENCE_REFERENCE_URL}\nیا: صفحه را در Confluence باز کنید، Ctrl+A و Ctrl+C بزنید و اینجا Paste کنید.`}
              onPaste={(e) => {
                const html = e.clipboardData.getData('text/html');
                if (!html) return;
                e.preventDefault();
                setSource({ content: html, preview: e.clipboardData.getData('text/plain') || html });
              }}
              onChange={(e) => setSource({ content: e.target.value, preview: e.target.value })}
            />
            {isLink(source.content) && status && !status.tokenSet && (
              <p className="hint warn">
                ایمپورت با لینک به توکن Confluence نیاز دارد (<code>CONFLUENCE_TOKEN</code> در <code>.env.local</code>). فعلاً محتوای صفحه را کپی و Paste کنید.
              </p>
            )}
            <div className="row-between">
              <span className="hint">صفحهٔ Use Case یا صفحهٔ نمودارها؛ نوع صفحه خودکار تشخیص داده می‌شود.</span>
              <button type="button" className="btn btn-primary" onClick={importSource} disabled={!!busy || !source.content.trim()}>
                ایمپورت
              </button>
            </div>
          </div>
        )}

        {startTab === 'ai' && (
          <div className="stack">
            <textarea
              className="input-area"
              dir="rtl"
              rows={6}
              value={ws.input}
              onChange={(e) => update({ input: e.target.value })}
              aria-label="نیازمندی‌های Use Case"
              placeholder="مثلاً: Vendor از صفحه کوپن‌ها روی «ایجاد کوپن جدید» کلیک می‌کند… درصد تخفیف بین ۵ تا ۹۵ و مضرب ۵…"
            />
            <div className="row-between">
              <span className="hint">با {providerLabel(ws.settings)}. اطلاعاتی که در متن نیست ساخته نمی‌شود.</span>
              <button type="button" className="btn btn-primary" onClick={generate} disabled={!!busy}>
                ساخت Use Case و فلوچارت
              </button>
            </div>
          </div>
        )}

        {startTab === 'empty' && (
          <div className="choice-grid">
            <button type="button" className="export-option" onClick={() => addDoc(newUseCaseDoc())}>
              <strong>Use Case جدید</strong>
              <span>صفحهٔ Use Case (Preconditions تا Related Use Cases) و فلوچارت آن.</span>
            </button>
            <button type="button" className="export-option" onClick={() => addDoc(newOverviewDoc('صفحهٔ نمودارهای جدید'))}>
              <strong>صفحهٔ نمودار جدید</strong>
              <span>بخش‌های «Domain — Service» با Description، Mermaid و تصویر.</span>
            </button>
          </div>
        )}
        {busyBar}
      </section>

      <section className="card" aria-labelledby="uc-docs">
        <h2 id="uc-docs">اسناد شما</h2>
        {ws.docs.length === 0 ? (
          <p className="empty">هنوز سندی ندارید. از بالا یک صفحه را ایمپورت کنید یا بسازید.</p>
        ) : (
          <ul className="doc-list">
            {ws.docs.map((d) => {
              const errors = errorCount(validateDoc(d, ws.docs));
              return (
                <li key={d.id}>
                  <button type="button" className="doc-open" onClick={() => open(d.id)}>
                    <span className="doc-kind">{d.kind === 'usecase' ? 'Use Case' : 'نمودارها'}</span>
                    <strong dir="auto">{d.kind === 'usecase' && d.useCase.ucId ? `${d.useCase.ucId} — ${d.name}` : d.name}</strong>
                    <small className="hint">
                      {d.kind === 'overview' && `${fa(d.sections.length)} بخش · `}
                      {new Date(d.updatedAt).toLocaleDateString('fa-IR')}
                    </small>
                    <span className={`badge ${errors ? 'bad' : 'ok'}`}>{errors ? `${fa(errors)} خطا` : '✓'}</span>
                  </button>
                  <div className="btn-group">
                    <button type="button" className="btn btn-sm" onClick={() => duplicateDoc(d)} aria-label={`کپی ${d.name}`}>
                      کپی
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost-danger" onClick={() => deleteDoc(d)} aria-label={`حذف ${d.name}`}>
                      حذف
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div>
        <button type="button" className="link" onClick={() => setGuideOpen((v) => !v)}>
          {guideOpen ? 'بستن راهنمای قوانین' : 'راهنمای قوانین Confluence'}
        </button>
      </div>
      {guideOpen && <UcGuidePanel />}
    </main>
  );

  const docView = doc && (
    <main>
      <div className="doc-bar card">
        <button type="button" className="btn btn-sm" onClick={() => setOpenId(null)}>
          → اسناد
        </button>
        <div className="doc-title">
          <button type="button" className="bare-btn" onClick={renameDoc} title="تغییر نام">
            <strong dir="auto">{doc.name}</strong> <span className="hint">✎</span>
          </button>
          {doc.source?.url && (
            <a className="hint" href={doc.source.url} target="_blank" rel="noreferrer">
              صفحه در Confluence{doc.source.version !== undefined && ` · نسخهٔ ${doc.source.version}`}
            </a>
          )}
        </div>
        <span className={`badge ${errorCount(issues) ? 'bad' : 'ok'}`}>{errorCount(issues) ? `${fa(errorCount(issues))} خطا` : '✓ مطابق قوانین'}</span>
        <button type="button" className="btn btn-primary" onClick={() => setExportOpen(true)}>
          خروجی برای Confluence
        </button>
        {busyBar}
      </div>

      {doc.kind === 'usecase' ? (
        <UseCaseView
          doc={doc}
          tab={ucTab}
          onTab={setUcTab}
          issues={issues}
          busy={!!busy}
          aiEnabled={ws.settings.provider !== 'basic'}
          onChange={setDoc}
          onDrawOffline={() => drawOffline(doc)}
          onDrawAi={() => drawAi(doc)}
        />
      ) : (
        <OverviewView
          doc={doc}
          index={Math.min(sectionIndex, Math.max(doc.sections.length - 1, 0))}
          onIndex={setSectionIndex}
          useCases={ws.docs.filter((d): d is UseCaseDoc => d.kind === 'usecase' && hasDiagram(d.flowchart))}
          onChange={setDoc}
          confirmDelete={(s, n) => confirm({ title: 'بخش حذف شود؟', message: `«${n}. ${s.heading}» حذف می‌شود و شمارهٔ بخش‌های بعدی یکی کم می‌شود.`, confirmLabel: 'حذف', danger: true })}
        />
      )}

      {aiIssues.length > 0 && (
        <section className="card">
          <h4>نکته‌های AI دربارهٔ اطلاعات ناقص</h4>
          <ul className="issues">
            {aiIssues.map((i) => (
              <li key={i} className="issue-warning">
                {i}
              </li>
            ))}
          </ul>
        </section>
      )}

      {exportOpen && <ExportDialog doc={doc} errors={errorCount(issues)} sectionIndex={sectionIndex} initialTarget={doc.kind === 'usecase' && ucTab === 'flowchart' ? 'section' : 'page'} onPublished={onPublished} onClose={() => setExportOpen(false)} />}
    </main>
  );

  return (
    <div className="app">
      <header className="topbar">
        <button type="button" className="brand bare-btn" onClick={() => setOpenId(null)} title="صفحهٔ اصلی">
          <UseCaseLogo />
          <div>
            <h1 className="wordmark" dir="ltr" aria-label="snapp usecase!">
              <span className="wordmark-text" aria-hidden="true">
                snapp <span className="wordmark-seed">usecase</span>
              </span>
              <span className="wordmark-bang" aria-hidden="true">
                !
              </span>
            </h1>
            <p className="tagline">Use Case و فلوچارت Food Partner طبق قوانین Confluence</p>
          </div>
        </button>
        <div className="topbar-actions">
          {modeSwitch}
          <ThemeSwitch />
          <button type="button" className="btn provider-chip" onClick={() => setSettingsOpen(true)} title="روش ساخت با AI">
            <span className={`dot ${ws.settings.provider === 'basic' ? 'off' : 'on'}`} aria-hidden="true" />
            {providerLabel(ws.settings)} · تنظیمات
          </button>
        </div>
      </header>
      {docView ?? home}
      {settingsOpen && (
        <SettingsDialog
          settings={ws.settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(settings) => {
            update({ settings });
            notify('success', `روش ساخت: ${providerLabel(settings)}.`);
          }}
        />
      )}
    </div>
  );
}

// ---- Use Case document: two tabs ----------------------------------------------------------------

interface UseCaseViewProps {
  doc: UseCaseDoc;
  tab: UcTab;
  onTab: (t: UcTab) => void;
  issues: UcIssue[];
  busy: boolean;
  aiEnabled: boolean;
  onChange: (d: UseCaseDoc) => void;
  onDrawOffline: () => void;
  onDrawAi: () => void;
}

function UseCaseView({ doc, tab, onTab, issues, busy, aiEnabled, onChange, onDrawOffline, onDrawAi }: UseCaseViewProps) {
  const isFlow = (i: UcIssue) => !!i.where?.startsWith('فلوچارت');
  const flowIssues = issues.filter(isFlow).map((i) => ({ ...i, where: i.where?.replace(/^فلوچارت · /, '') }));
  const ucIssues = issues.filter((i) => !isFlow(i));
  const tabLabel = (label: string, list: UcIssue[]) => (
    <>
      {label}
      {errorCount(list) > 0 && <span className="badge bad">{fa(errorCount(list))}</span>}
    </>
  );
  return (
    <section className="card">
      <div className="segmented tabs" role="tablist" aria-label="بخش‌های سند">
        <button type="button" role="tab" aria-selected={tab === 'usecase'} onClick={() => onTab('usecase')}>
          {tabLabel('۱. Use Case (الگوریتم)', ucIssues)}
        </button>
        <button type="button" role="tab" aria-selected={tab === 'flowchart'} onClick={() => onTab('flowchart')}>
          {tabLabel('۲. فلوچارت', flowIssues)}
        </button>
      </div>

      {tab === 'usecase' ? (
        <>
          <UcIssuesPanel issues={ucIssues} />
          <UseCaseEditor useCase={doc.useCase} onChange={(useCase) => onChange({ ...doc, useCase })} />
          <div className="next-step">
            <button type="button" className="btn btn-primary" onClick={() => onTab('flowchart')}>
              بعدی: فلوچارت ←
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="draw-bar">
            <span className="hint">فلوچارت را از روی الگوریتم بسازید یا کد Mermaid را مستقیم ویرایش کنید.</span>
            <div className="btn-group">
              <button type="button" className="btn btn-sm" onClick={onDrawOffline} disabled={busy}>
                رسم از روی الگوریتم
              </button>
              <button type="button" className="btn btn-sm btn-primary" onClick={onDrawAi} disabled={busy || !aiEnabled} title={aiEnabled ? undefined : 'در تنظیمات Claude Code را انتخاب کنید'}>
                رسم / اصلاح با AI
              </button>
            </div>
          </div>
          <UcIssuesPanel issues={flowIssues} />
          <DiagramEditor
            section={doc.flowchart}
            number={doc.flowchartNumber}
            onChange={(flowchart) => onChange({ ...doc, flowchart })}
            onNumberChange={(flowchartNumber) => onChange({ ...doc, flowchartNumber })}
          />
        </>
      )}
    </section>
  );
}

// ---- Diagram page: section list + one section at a time -------------------------------------------

interface OverviewViewProps {
  doc: OverviewDoc;
  index: number;
  onIndex: (i: number) => void;
  useCases: UseCaseDoc[];
  onChange: (d: OverviewDoc) => void;
  confirmDelete: (s: DiagramSection, n: number) => Promise<boolean>;
}

function OverviewView({ doc, index, onIndex, useCases, onChange, confirmDelete }: OverviewViewProps) {
  const section = doc.sections[index];
  const setSections = (sections: DiagramSection[], next = index) => {
    onChange({ ...doc, sections });
    onIndex(Math.max(0, Math.min(next, sections.length - 1)));
  };
  /** New sections go before the closing "Overall Service Dependency Diagram", which stays last. */
  const insert = (s: DiagramSection) => {
    const last = doc.sections[doc.sections.length - 1];
    const at = last && /Overall Service Dependency/i.test(last.heading) ? doc.sections.length - 1 : doc.sections.length;
    setSections([...doc.sections.slice(0, at), s, ...doc.sections.slice(at)], at);
  };
  return (
    <div className="overview">
      <nav className="card section-nav" aria-label="بخش‌های صفحه">
        <h3 className="nav-title">بخش‌ها</h3>
        <ol dir="ltr">
          {doc.sections.map((s, i) => {
            const errors = errorCount(validateSection(s, i + 1));
            const changed = s.publishedMermaid !== undefined && s.mermaid !== s.publishedMermaid;
            return (
              <li key={s.id}>
                <button type="button" aria-current={i === index ? 'true' : undefined} onClick={() => onIndex(i)}>
                  <span dir="ltr">
                    {i + 1}. {s.heading || 'بدون عنوان'}
                  </span>
                  {changed && <span className="dot on" title="تغییر کرده" />}
                  {errors > 0 && <span className="badge bad">{fa(errors)}</span>}
                </button>
              </li>
            );
          })}
        </ol>
        <button type="button" className="btn btn-sm" onClick={() => insert(blankSection())}>
          + بخش جدید
        </button>
        {useCases.length > 0 && (
          <select
            value=""
            aria-label="افزودن فلوچارت یک Use Case"
            onChange={(e) => {
              const uc = useCases.find((d) => d.id === e.target.value);
              if (uc) insert({ ...structuredClone(uc.flowchart), id: newId('sec'), publishedMermaid: undefined });
            }}
          >
            <option value="">+ از فلوچارت یک Use Case…</option>
            {useCases.map((d) => (
              <option key={d.id} value={d.id}>
                {d.useCase.ucId || d.name}
              </option>
            ))}
          </select>
        )}
      </nav>

      <section className="card">
        {!section ? (
          <p className="empty">این صفحه بخشی ندارد. «+ بخش جدید» را بزنید.</p>
        ) : (
          <>
            <div className="row-between">
              <h3 dir="ltr">
                {index + 1}. {section.heading || 'بدون عنوان'}
              </h3>
              <div className="btn-group">
                <button type="button" className="btn btn-sm" disabled={index === 0} onClick={() => setSections(moveItem(doc.sections, index, index - 1), index - 1)} aria-label="انتقال به بالا">
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={index === doc.sections.length - 1}
                  onClick={() => setSections(moveItem(doc.sections, index, index + 1), index + 1)}
                  aria-label="انتقال به پایین"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost-danger"
                  onClick={async () => {
                    if (await confirmDelete(section, index + 1)) setSections(doc.sections.filter((_, j) => j !== index), index - 1);
                  }}
                >
                  حذف بخش
                </button>
              </div>
            </div>
            <UcIssuesPanel issues={validateSection(section, index + 1)} />
            <DiagramEditor key={section.id} section={section} number={index + 1} onChange={(s) => setSections(doc.sections.map((x, j) => (j === index ? s : x)))} />
          </>
        )}
      </section>
    </div>
  );
}

function UseCaseLogo() {
  return (
    <svg className="brand-logo" viewBox="0 0 64 64" width={48} height={48} aria-hidden="true">
      <rect width="64" height="64" rx="15" fill="#f3f1ff" />
      <g fill="none" stroke="#4a42fa" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round">
        <rect x="9" y="9" width="20" height="12" rx="3" />
        <path d="M19 21v8" />
        <path d="M19 29l9 7-9 7-9-7z" />
        <path d="M28 36h9" />
        <rect x="37" y="30" width="18" height="12" rx="3" />
        <path d="M19 43v8" />
      </g>
      <path d="M48.5 10H58L50.5 40H45.5Z" fill="#f20072" />
    </svg>
  );
}
