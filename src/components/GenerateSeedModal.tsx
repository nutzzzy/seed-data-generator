import { useEffect, useMemo, useRef, useState } from 'react';
import { agentsApi, type Agent } from '../lib/agentsClient';
import { copyRich, copyText } from '../lib/clipboard';
import { DEFAULT_SEED_CONFLUENCE_URL } from '../lib/defaults';

import { generateTable, GenerationError, type AiTransport } from '../lib/generate';
import { seedPageBody, toSeedDataHtml, toSeedDataText } from '../lib/seedData';
import { assignFreeIds, previewDocument, seedPages, type Renamed } from '../lib/seedPublish';
import { ApiError, confluenceApi, seedJobsApi, type ConfluenceStatus, type DuplicateMatch, type JobView, type PublishResult, type TargetPage } from '../lib/seedJobsClient';
import type { GeneratedTable, Settings, Standard, Template } from '../lib/types';
import { validateTable } from '../lib/validate';
import { ConfluenceSettings } from './ConfluenceSettings';
import { useDialogs } from './Dialogs';
import { ExportPanel } from './ExportPanel';
import { TableEditor } from './TableEditor';
import { useToast } from './Toasts';
import { ValidationPanel } from './ValidationPanel';
import { fa } from '../lib/bidi';

/** Provider type of the Codex CLI agent, the default agent in this modal. */
const CODEX_PROVIDER = 'codex-cli';
/** Option shown (and selected) as «Codex (پیش‌فرض)» when no Codex agent has been added yet; Settings are not changed. */
const CODEX_PLACEHOLDER = '__codex__';

export interface ModalApis {
  agents: Pick<typeof agentsApi, 'list' | 'test'>;
  confluence: typeof confluenceApi;
  jobs: typeof seedJobsApi;
}

interface Props {
  settings: Settings;
  standard: Standard;
  template: Template;
  /** The notes from step 1, used as the starting request. */
  initialRequest: string;
  transport?: AiTransport;
  /** Every generated (or edited) table is handed back, so copying stays possible after the modal closes. */
  onGenerated: (table: GeneratedTable) => void;
  onClose: () => void;
  apis?: ModalApis;
  /** Polling interval for the job; shorter in tests. */
  pollMs?: number;
}

type Phase = 'form' | 'job' | 'generating' | 'preview' | 'done';

const STAGES = [
  { title: 'ورودی', hint: 'لینک، Agent و درخواست' },
  { title: 'بررسی Confluence', hint: 'خواندن صفحات، تکراری‌ها و ساخت' },
  { title: 'بازبینی و انتشار', hint: 'پیش‌نمایش، ویرایش و تأیید' },
];
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const SIMILARITY: Record<DuplicateMatch['similarity'], string> = { exact: 'یکسان', high: 'بسیار مشابه', medium: 'تا حدی مشابه' };
const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleString('fa-IR') : '');

function stageOf(phase: Phase): number {
  if (phase === 'form') return 0;
  if (phase === 'job' || phase === 'generating') return 1;
  if (phase === 'preview') return 2;
  return 3;
}

export function GenerateSeedModal({ settings, standard, template, initialRequest, transport, onGenerated, onClose, apis, pollMs = 1000 }: Props) {
  const api: ModalApis = apis ?? { agents: agentsApi, confluence: confluenceApi, jobs: seedJobsApi };
  const { confirm } = useDialogs();
  const notify = useToast();

  // ---- Step 1: context ------------------------------------------------------------------------
  const [status, setStatus] = useState<ConfluenceStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [url, setUrl] = useState(DEFAULT_SEED_CONFLUENCE_URL);
  /** The link is locked to the QA Seed Data page until the user chooses to change it. */
  const [urlEditable, setUrlEditable] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [request, setRequest] = useState(initialRequest);
  const [instructions, setInstructions] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    api.confluence.status().then(setStatus, (err) => setStatusError(errText(err)));
    api.agents.list().then(
      (d) => {
        const enabled = d.agents.filter((a) => a.enabled);
        setAgents(enabled);
        // Codex is always the selected default here, whatever Settings say; the placeholder stands in until it is added.
        setAgentId(enabled.find((a) => a.providerType === CODEX_PROVIDER)?.id ?? CODEX_PLACEHOLDER);
      },
      (err) => setStatusError(errText(err)),
    );
    // Load once when the modal opens.
  }, []);

  // ---- Steps 2–3: job (retrieval + duplicate detection) ------------------------------------------
  const [phase, setPhase] = useState<Phase>('form');
  const [job, setJob] = useState<JobView | null>(null);
  const [target, setTarget] = useState<string>('');

  useEffect(() => {
    if (phase !== 'job' || !job || !['retrieving', 'checking'].includes(job.status)) return;
    const t = setTimeout(() => {
      api.jobs.get(job.id).then(setJob, (err) => setJob({ ...job, status: 'failed', error: errText(err) }));
    }, pollMs);
    return () => clearTimeout(t);
  }, [phase, job]);

  /** What is still needed before the workflow can start, shown next to the Start button. */
  const missing = useMemo(() => {
    const out: string[] = [];
    if (!status?.tokenSet) out.push('اتصال Confluence ذخیره نشده است: در کادر بالا توکن را وارد کنید و «ذخیرهٔ تنظیمات Confluence» را بزنید.');
    if (!url.trim()) out.push('لینک صفحهٔ Confluence را وارد کنید.');
    else {
      let host = '';
      try {
        host = new URL(url.trim()).host;
      } catch {
        out.push('لینک Confluence معتبر نیست؛ لینک کامل صفحه را (با https://) وارد کنید.');
      }
      if (host && status && host !== new URL(status.baseUrl).host) out.push(`لینک باید از ${new URL(status.baseUrl).host} باشد.`);
    }
    if (agents && !agentId) out.push('یک Agent انتخاب کنید (در تنظیمات، Agent فعالی وجود ندارد).');
    if (agentId === CODEX_PLACEHOLDER) out.push('Agent «Codex» هنوز اضافه نشده است: در «تنظیمات» Agent Codex را اضافه کنید یا Agent دیگری انتخاب کنید.');
    const chosen = agents?.find((a) => a.id === agentId);
    const key = chosen?.secrets.apiKey;
    if (chosen?.providerType === 'anthropic' && key && !key.set && !key.fromEnv) {
      out.push(`Agent «${chosen.name}» کلید API ندارد: در «تنظیمات» کلید را برای این Agent وارد کنید یا Agent دیگری (مثلاً Claude Code) انتخاب کنید.`);
    }
    if (!request.trim()) out.push('توضیح دهید چه Seed Data لازم دارید.');
    return out;
  }, [status, url, agents, agentId, request]);

  const [checkingAgent, setCheckingAgent] = useState(false);

  const start = async () => {
    setFormError(null);
    if (missing.length) return;
    // Check the agent before reading Confluence, so a missing key or install shows up now and not minutes later.
    setCheckingAgent(true);
    try {
      const test = await api.agents.test({ id: agentId });
      if (!test.ok) return setFormError(`Agent «${agents?.find((a) => a.id === agentId)?.name ?? agentId}» آماده نیست: ${test.message}`);
    } catch (err) {
      return setFormError(errText(err));
    } finally {
      setCheckingAgent(false);
    }
    try {
      const { id } = await api.jobs.start({ url: url.trim(), agentId, request, instructions });
      setJob(await api.jobs.get(id));
      setPhase('job');
    } catch (err) {
      setFormError(errText(err));
    }
  };

  const decide = async (action: 'cancel' | 'new' | 'overwrite') => {
    if (!job) return;
    if (action === 'overwrite' && !target) return notify('error', 'صفحه‌ای را که باید بازنویسی شود انتخاب کنید.');
    try {
      const next = await api.jobs.decide(job.id, action, action === 'overwrite' ? target : undefined);
      setJob(next);
      if (action === 'cancel') {
        notify('info', 'ساخت لغو شد. چیزی در Confluence تغییر نکرد.');
        onClose();
      }
    } catch (err) {
      notify('error', errText(err));
    }
  };

  // ---- Step 4: generation with the selected agent -------------------------------------------------
  const [table, setTable] = useState<GeneratedTable | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const genController = useRef<AbortController | null>(null);
  const [targetPage, setTargetPage] = useState<TargetPage | null>(null);

  const generate = async (j: JobView) => {
    if (!j.context) return;
    setPhase('generating');
    setGenError(null);
    const controller = new AbortController();
    genController.current = controller;
    try {
      if (j.decision?.action === 'overwrite') setTargetPage(await api.jobs.target(j.id));
      const next = await generateTable({
        standard,
        template,
        input: j.context.text,
        settings: { ...settings, provider: 'agent', agentId: j.agentId, agentName: j.agentName, timeoutSeconds: Math.max(settings.timeoutSeconds, 300) },
        signal: controller.signal,
        transport,
      });
      // An ID that already exists gets the next free number for its prefix (the page being overwritten may keep its own).
      const fresh = j.decision?.action === 'overwrite' ? await api.jobs.target(j.id).catch(() => null) : null;
      const { table: numbered, renamed: changed } = assignFreeIds(next, j.existingIds ?? [], fresh?.title);
      setRenamed(changed);
      setTable(numbered);
      onGenerated(numbered);
      setParents({});
      setApproved(false);
      setPhase('preview');
    } catch (err) {
      if (controller.signal.aborted) return;
      setGenError(err instanceof GenerationError || err instanceof ApiError ? err.message : errText(err));
    } finally {
      genController.current = null;
    }
  };

  useEffect(() => {
    if (phase === 'job' && job?.status === 'ready') void generate(job);
  }, [phase, job?.status]);

  // ---- Step 5: preview, edit, copy, approval -------------------------------------------------------
  const [tab, setTab] = useState<'preview' | 'diff' | 'edit' | 'copy'>('preview');
  /** Parent page per Seed Data ID (create); defaults to the Domain page of its Domain. */
  const [parents, setParents] = useState<Record<string, string>>({});
  const [renamed, setRenamed] = useState<Renamed[]>([]);
  const [approved, setApproved] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [result, setResult] = useState<PublishResult | null>(null);

  const isUpdate = job?.decision?.action === 'overwrite';
  const validation = useMemo(() => (table ? validateTable(table, template, standard) : null), [table, template, standard]);
  /** One Confluence page per Seed Data (title = ID). */
  const pages = useMemo(() => (table ? seedPages(table) : []), [table]);
  /** Overwrite writes one Seed Data: the one with the page's ID, else the first. */
  const updatePage = isUpdate ? (pages.find((p) => p.title === targetPage?.title) ?? pages[0]) : undefined;
  const publishPages = isUpdate ? (updatePage ? [updatePage] : []) : pages;
  const invalid = publishPages.filter((p) => !p.valid);

  /** Pages a new Seed Data page can go under: the Domain pages first, then the pages that were read. */
  const parentOptions = useMemo(() => {
    if (!job) return [];
    const domainPages = (job.domains ?? []).filter((d) => d.pageId).map((d) => ({ id: d.pageId!, label: `${d.name} (Domain ${d.code})` }));
    const read = job.pages.filter((p) => !domainPages.some((d) => d.id === p.id)).map((p) => ({ id: p.id, label: `${'— '.repeat(p.depth)}${p.title}` }));
    return [...domainPages, ...read];
  }, [job]);
  const parentOf = (p: { title: string; domain: string }) =>
    parents[p.title] ?? job?.domains?.find((d) => d.code === p.domain)?.pageId ?? job?.pages[0]?.id ?? '';

  const editTable = (t: GeneratedTable) => {
    setTable(t);
    onGenerated(t);
    setApproved(false); // edits need a fresh approval
  };

  const copy = async (label: string, run: () => Promise<boolean>) => {
    if (await run()) notify('success', `${label} کپی شد.`);
    else notify('error', 'مرورگر اجازهٔ کپی نداد؛ از گزینه‌های «کپی برای Confluence» پایین همین تب استفاده کنید.');
  };

  const publish = async () => {
    if (!job || !table || !approved || invalid.length) return;
    setPublishError(null);
    if (isUpdate) {
      const rename = updatePage && targetPage && updatePage.title !== targetPage.title ? ` عنوان صفحه از «${targetPage.title}» به «${updatePage.title}» تغییر می‌کند.` : '';
      const ok = await confirm({
        title: `محتوای صفحهٔ «${targetPage?.title}» به‌روزرسانی شود؟`,
        message: `محتوای فعلی این صفحه با Seed Data جدید جایگزین می‌شود (نمای «قبل / بعد» را ببینید).${rename}`,
        confirmLabel: 'بله، به‌روزرسانی شود',
        danger: true,
      });
      if (!ok) return;
    }
    setPublishing(true);
    try {
      const res =
        isUpdate && updatePage
          ? await api.jobs.publish(job.id, {
              approved: true,
              mode: 'update',
              pageId: targetPage!.id,
              expectedVersion: targetPage!.version,
              title: updatePage.title,
              storage: updatePage.storage,
              labels: updatePage.labels,
            })
          : await api.jobs.publish(job.id, {
              approved: true,
              mode: 'create',
              pages: pages.map((p) => ({ title: p.title, storage: p.storage, labels: p.labels, parentId: parentOf(p) })),
            });
      setResult(res);
      setPhase('done');
      notify('success', 'Seed Data در Confluence منتشر شد.');
    } catch (err) {
      const fresh = err instanceof ApiError && err.status === 409 ? (err.data?.conflict as TargetPage | undefined) : undefined;
      if (fresh && targetPage) {
        // Someone changed the page after the preview: show the new version and ask again.
        setTargetPage({ ...fresh, id: targetPage.id });
        setApproved(false);
        setConflict(errText(err));
        setTab('diff');
      } else setPublishError(errText(err));
    } finally {
      setPublishing(false);
    }
  };

  // ---- Closing ---------------------------------------------------------------------------------------
  const close = async () => {
    genController.current?.abort();
    if (job && ['retrieving', 'checking', 'awaiting-decision', 'ready'].includes(job.status)) await api.jobs.cancel(job.id).catch(() => {});
    onClose();
  };

  const stage = stageOf(phase);
  const agentName = agents?.find((a) => a.id === agentId)?.name ?? job?.agentName ?? '';
  const running = phase === 'job' || phase === 'generating';
  const elapsed = useElapsed(running && !genError && job?.status !== 'failed' && job?.status !== 'awaiting-decision');
  const [selected, setSelected] = useState(0);
  const shownPages = isUpdate ? publishPages : publishPages.slice(Math.min(selected, publishPages.length - 1), Math.min(selected, publishPages.length - 1) + 1);
  const noticeCount = table && job ? table.notes.length + job.failures.length + (job.context?.omitted.length ?? 0) + (job.notes?.length ?? 0) : 0;

  return (
    <div className="dialog-backdrop">
      <div className="dialog seed-wizard" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="seed-modal-title" onKeyDown={(e) => e.key === 'Escape' && phase === 'form' && close()}>
        <header className="wizard-head">
          <div className="wizard-title">
            <h2 id="seed-modal-title">ساخت Seed Data از روی Confluence</h2>
            <button type="button" className="icon-btn" onClick={phase === 'done' ? onClose : close} disabled={publishing} aria-label="بستن پنجره" title="بستن">
              ✕
            </button>
          </div>
          <ol className="stepper" aria-label="مراحل">
            {STAGES.map((s, i) => (
              <li key={s.title} className={i < stage ? 'done' : i === stage ? 'current' : ''} aria-current={i === stage ? 'step' : undefined}>
                <span className="stepper-dot" aria-hidden="true">
                  {i < stage ? '✓' : fa(i + 1)}
                </span>
                <span className="stepper-text">
                  <b>{s.title}</b>
                  <small>{s.hint}</small>
                </span>
              </li>
            ))}
          </ol>
        </header>

        {/* ---- ۱. Input ---- */}
        {phase === 'form' && (
          <>
            <div className="wizard-body">
              {statusError && <p className="error-box">{statusError}</p>}
              {status && !status.tokenSet && <ConfluenceSettings status={status} onChange={setStatus} compact api={api.confluence} />}
              <div className="form-grid">
                <section className="form-card">
                  <h3>منبع</h3>
                  <label className="field">
                    <span>
                      لینک صفحهٔ Confluence <small>همهٔ زیرصفحه‌های آن هم خوانده می‌شوند</small>
                    </span>
                    <div className="url-lock">
                      <input
                        className="mono"
                        dir="ltr"
                        type="url"
                        required
                        aria-label="لینک صفحهٔ Confluence"
                        placeholder={`${status?.baseUrl ?? 'https://confluence.snappfood.ir'}/spaces/…/pages/…`}
                        value={url}
                        disabled={!urlEditable}
                        onChange={(e) => setUrl(e.target.value)}
                      />
                      {urlEditable ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => (setUrl(DEFAULT_SEED_CONFLUENCE_URL), setUrlEditable(false))}
                          title="برگرداندن لینک به صفحهٔ QA Seed Data و قفل کردن آن"
                        >
                          لینک پیش‌فرض
                        </button>
                      ) : (
                        <button type="button" className="btn" onClick={() => setUrlEditable(true)} title="باز کردن قفل لینک برای وارد کردن صفحهٔ دیگر">
                          تغییر لینک
                        </button>
                      )}
                    </div>
                  </label>
                  <label className="field">
                    <span>
                      Agent <small>بررسی تکراری‌ها و ساخت با همین Agent انجام می‌شود</small>
                    </span>
                    <select aria-label="Agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                      {agents && !agents.some((a) => a.providerType === CODEX_PROVIDER) && <option value={CODEX_PLACEHOLDER}>Codex (پیش‌فرض)</option>}
                      {[...(agents ?? [])]
                        .sort((a, b) => Number(b.providerType === CODEX_PROVIDER) - Number(a.providerType === CODEX_PROVIDER))
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                            {a.providerType === CODEX_PROVIDER ? ' (پیش‌فرض)' : ''}
                          </option>
                        ))}
                    </select>
                  </label>
                </section>
                <section className="form-card">
                  <h3>درخواست</h3>
                  <label className="field">
                    <span>چه Seed Data لازم دارید؟</span>
                    <textarea aria-label="توضیح Seed Data" rows={6} dir="rtl" value={request} onChange={(e) => setRequest(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>
                      توضیحات بیشتر <small>اختیاری</small>
                    </span>
                    <textarea aria-label="توضیحات بیشتر" rows={2} dir="rtl" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
                  </label>
                </section>
              </div>
              {missing.length > 0 && (
                <div className="missing" role="status" aria-label="موارد لازم برای شروع">
                  <b>برای شروع لازم است:</b>
                  <ul>
                    {missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </div>
              )}
              {formError && (
                <p className="error-box" role="alert">
                  {formError}
                </p>
              )}
            </div>
            <footer className="wizard-foot">
              <span className="hint">قبل از هر تغییری در Confluence پیش‌نمایش نشان داده می‌شود و تأیید شما لازم است.</span>
              <div className="dialog-actions">
                <button type="button" className="btn" onClick={close}>
                  انصراف
                </button>
                <button type="button" className="btn btn-primary" onClick={start} disabled={missing.length > 0 || checkingAgent}>
                  {checkingAgent ? (
                    <>
                      <span className="spinner" aria-hidden="true" /> در حال بررسی Agent…
                    </>
                  ) : (
                    'شروع'
                  )}
                </button>
              </div>
            </footer>
          </>
        )}

        {/* ---- ۲. Confluence: read, compare, generate ---- */}
        {running && job && (
          <>
            <div className="wizard-body">
              <ActivityList job={job} phase={phase} genError={genError} elapsed={elapsed} />
              {job.status === 'failed' && (
                <p className="error-box" role="alert">
                  {job.error}
                </p>
              )}
              {phase === 'generating' && genError && (
                <p className="error-box" role="alert">
                  {genError}
                </p>
              )}
              {phase === 'job' && job.status === 'awaiting-decision' && <DecisionView job={job} target={target} setTarget={setTarget} decide={decide} />}
            </div>
            <footer className="wizard-foot">
              <span className="hint">{job.status === 'awaiting-decision' ? 'یکی از گزینه‌های بالا را انتخاب کنید.' : 'می‌توانید هر زمان لغو کنید؛ تا قبل از انتشار چیزی در Confluence تغییر نمی‌کند.'}</span>
              <div className="dialog-actions">
                <button type="button" className="btn" onClick={close}>
                  {job.status === 'failed' ? 'بستن' : 'لغو'}
                </button>
                {job.status === 'failed' && (
                  <button type="button" className="btn btn-primary" onClick={() => setPhase('form')}>
                    تلاش دوباره
                  </button>
                )}
                {phase === 'generating' && genError && (
                  <button type="button" className="btn btn-primary" onClick={() => generate(job)}>
                    تلاش دوباره
                  </button>
                )}
              </div>
            </footer>
          </>
        )}

        {/* ---- ۳. Review and publish ---- */}
        {phase === 'preview' && table && job && (
          <>
            <div className="wizard-body">
              <div className="review-summary">
                <span className={`badge ${isUpdate ? 'bad' : 'ok'}`}>{isUpdate ? 'به‌روزرسانی صفحهٔ موجود' : `ساخت ${fa(publishPages.length)} صفحهٔ جدید`}</span>
                <span className="chip">{fa(table.rows.length)} ردیف</span>
                <span className={`chip ${validation?.errors.length ? 'bad' : ''}`}>{fa(validation?.errors.length ?? 0)} خطا</span>
                <span className={`chip ${validation?.warnings.length ? 'warn' : ''}`}>{fa(validation?.warnings.length ?? 0)} هشدار</span>
                <span className="chip">
                  Agent: <bdi>{job.agentName}</bdi>
                </span>
              </div>

              {invalid.length > 0 && (
                <p className="error-box" role="alert">
                  Seed Data ID این موارد طبق قالب SD-[DOMAIN]-[ENTITY]-[STATE]-[NNN] نیست و عنوان صفحه نمی‌شود: {invalid.map((p) => p.title).join('، ')}. در تب «ویرایش» درستش کنید.
                </p>
              )}
              {conflict && (
                <p className="error-box" role="alert">
                  {conflict}
                </p>
              )}
              {renamed.length > 0 && (
                <p className="warn-box">
                  این Seed Data IDها قبلاً در Confluence وجود داشتند و شمارهٔ بعدی گرفتند:{' '}
                  <bdi dir="ltr">{renamed.map((r) => `${r.from} → ${r.to}`).join('، ')}</bdi>.
                </p>
              )}

              <div className="review-grid">
                <aside className="review-pages" aria-label={isUpdate ? 'صفحهٔ هدف' : 'صفحه‌های جدید'}>
                  {isUpdate && targetPage ? (
                    <div className="target-card">
                      <small className="hint">صفحهٔ هدف</small>
                      <a href={targetPage.url} target="_blank" rel="noopener noreferrer">
                        {targetPage.title}
                      </a>
                      <p className="hint">
                        نسخهٔ {fa(targetPage.version)}. محتوای صفحه با «{updatePage?.title}» جایگزین می‌شود
                        {updatePage && updatePage.title !== targetPage.title ? ` و عنوان صفحه به ${updatePage.title} تغییر می‌کند` : ''}.
                        {pages.length > 1 && ` فقط همین یک Seed Data روی صفحه نوشته می‌شود؛ ${fa(pages.length - 1)} مورد دیگر را می‌توانید کپی کنید.`}
                      </p>
                    </div>
                  ) : (
                    <ul className="page-plan">
                      {pages.map((p, i) => (
                        <li key={`${p.row}-${p.title}`} className={i === Math.min(selected, pages.length - 1) ? 'selected' : ''}>
                          <button type="button" className="page-pick" onClick={() => (setSelected(i), setTab('preview'))} aria-label={`نمایش ${p.title}`}>
                            <span className={`page-state ${p.valid ? 'ok' : 'bad'}`} aria-hidden="true">
                              {p.valid ? '✓' : '!'}
                            </span>
                            <span className={`mono ${p.valid ? '' : 'bad-text'}`} dir="ltr">
                              {p.title}
                            </span>
                          </button>
                          <label className="page-parent">
                            <span>زیر صفحهٔ</span>
                            <select aria-label={`صفحهٔ والد ${p.title}`} value={parentOf(p)} onChange={(e) => (setParents((x) => ({ ...x, [p.title]: e.target.value })), setApproved(false))}>
                              {parentOptions.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <small className="mono page-labels" dir="ltr">
                            {p.labels.join(' · ')}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                </aside>

                <div className="review-main">
                  <div className="tabs" role="tablist">
                    {(
                      [
                        ['preview', 'پیش‌نمایش Confluence'],
                        ...(isUpdate ? ([['diff', 'قبل / بعد']] as const) : []),
                        ['edit', 'ویرایش'],
                        ['copy', 'کپی و خروجی'],
                      ] as const
                    ).map(([id, label]) => (
                      <button key={id} type="button" role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {tab === 'preview' && shownPages.map((p) => <StorageFrame key={`${p.row}-${p.title}`} title={`پیش‌نمایش ${p.title}`} storage={p.storage} />)}
                  {tab === 'diff' && targetPage && updatePage && (
                    <div className="diff-grid">
                      <div>
                        <h4>
                          قبل: <bdi>{targetPage.title}</bdi> (نسخهٔ {fa(targetPage.version)})
                        </h4>
                        <StorageFrame title="محتوای فعلی صفحه" storage={targetPage.storage} />
                      </div>
                      <div>
                        <h4>
                          بعد: <bdi>{updatePage.title}</bdi>
                        </h4>
                        <StorageFrame title="محتوای بعد از به‌روزرسانی" storage={updatePage.storage} />
                      </div>
                    </div>
                  )}
                  {tab === 'edit' && (
                    <div className="stack">
                      <TableEditor table={table} issues={validation ? [...validation.errors, ...validation.warnings] : []} onChange={editTable} />
                      {validation && <ValidationPanel table={table} result={validation} notes={table.notes} />}
                    </div>
                  )}
                  {tab === 'copy' && (
                    <div className="stack">
                      <div className="actions-row">
                        <button type="button" className="btn btn-sm" onClick={() => copy('کل محتوا', () => copyRich(toSeedDataHtml(table), toSeedDataText(table)))}>
                          کپی کل محتوا
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() =>
                            copy('دادهٔ ساخت‌یافته (JSON)', () =>
                              copyText(JSON.stringify(table.rows.map((r) => Object.fromEntries(table.columns.map((c) => [c.name, r.cells[c.id] ?? '']))), null, 2)),
                            )
                          }
                        >
                          کپی دادهٔ ساخت‌یافته (JSON)
                        </button>
                      </div>
                      <ul className="section-list">
                        {pages.map((p) => {
                          const html = seedPageBody(table, table.rows[p.row].cells, 'paste');
                          return (
                            <li key={`${p.row}-${p.title}`}>
                              <span className="mono">{p.title}</span>
                              <button type="button" className="btn btn-sm" onClick={() => copy(p.title, () => copyRich(html, html.replace(/<[^>]+>/g, ' ')))}>
                                کپی این صفحه
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <ExportPanel table={table} name={pages[0]?.title || 'seed-data'} hasErrors={!!validation && !validation.ok} />
                    </div>
                  )}
                </div>
              </div>

              {noticeCount > 0 && (
                <details className="notes">
                  <summary>
                    نکته‌های Agent و خواندن صفحات ({fa(noticeCount)}) <small className="hint">فرضیات، اطلاعات ناقص و تناقض‌ها</small>
                  </summary>
                  <ul>
                    {table.notes.map((n, i) => (
                      <li key={`n${i}`}>
                        <bdi>{n.message}</bdi>
                      </li>
                    ))}
                    {job.failures.length > 0 && <li>{fa(job.failures.length)} صفحه خوانده نشد.</li>}
                    {(job.context?.omitted.length ?? 0) > 0 && (
                      <li>
                        {fa(job.context!.omitted.length)} صفحه به‌دلیل حجم به Agent داده نشد: {job.context!.omitted.join('، ')}.
                      </li>
                    )}
                    {job.notes?.map((n, i) => (
                      <li key={`j${i}`}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
              {(job.excludedReferences?.length ?? 0) > 0 && (
                <p className="hint">
                  <ReferenceNote job={job} />
                </p>
              )}
            </div>

            <footer className="wizard-foot">
              <div className="foot-main">
                <label className="check approve">
                  <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> پیش‌نمایش را بررسی کردم و همین محتوا در Confluence{' '}
                  {isUpdate ? 'به‌روزرسانی' : 'ساخته'} شود.
                </label>
                {publishError && (
                  <p className="status-line bad" role="alert">
                    {publishError}
                  </p>
                )}
              </div>
              <div className="dialog-actions">
                <button type="button" className="btn" onClick={close} disabled={publishing}>
                  انصراف (بدون انتشار)
                </button>
                <button type="button" className="btn" onClick={() => generate(job)} disabled={publishing}>
                  ساخت دوباره با {job.agentName}
                </button>
                <button type="button" className="btn btn-primary" onClick={publish} disabled={!approved || publishing || invalid.length > 0 || !publishPages.length}>
                  {publishing ? (
                    <>
                      <span className="spinner" aria-hidden="true" /> در حال انتشار…
                    </>
                  ) : (
                    'تأیید و انتشار'
                  )}
                </button>
              </div>
            </footer>
          </>
        )}

        {/* ---- Done ---- */}
        {phase === 'done' && result && (
          <>
            <div className="wizard-body">
              <div className="done-hero" role="status">
                <span className="done-icon" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <h3>{result.operation === 'create' ? `${fa(result.pages.length)} صفحهٔ جدید ساخته شد.` : 'صفحه به‌روزرسانی شد.'}</h3>
                  <p className="hint">
                    Agent: <bdi>{result.agentName}</bdi> · زمان انتشار: {fmtDate(result.publishedAt)}
                  </p>
                </div>
              </div>
              <div className="result-cards">
                {result.pages.map((p) => (
                  <dl key={p.pageId} className="result-grid">
                    <dt>عنوان</dt>
                    <dd className="mono" dir="ltr">
                      {p.title}
                    </dd>
                    <dt>آدرس</dt>
                    <dd>
                      <a className="mono" dir="ltr" href={p.url} target="_blank" rel="noopener noreferrer">
                        {p.url}
                      </a>
                    </dd>
                    <dt>Page ID</dt>
                    <dd className="mono">{p.pageId}</dd>
                    <dt>نسخه</dt>
                    <dd>{p.version}</dd>
                    <dt>برچسب‌ها (Label)</dt>
                    <dd className="mono">{p.labels.join(' · ') || '-'}</dd>
                    {p.warning && (
                      <>
                        <dt>هشدار</dt>
                        <dd className="bad-text">{p.warning}</dd>
                      </>
                    )}
                  </dl>
                ))}
              </div>
            </div>
            <footer className="wizard-foot">
              <span />
              <div className="dialog-actions">
                <button type="button" className="btn" onClick={onClose}>
                  بستن
                </button>
                <a className="btn btn-primary" href={result.pages[0]?.url} target="_blank" rel="noopener noreferrer">
                  باز کردن در Confluence
                </a>
              </div>
            </footer>
          </>
        )}
        {phase === 'form' && agentName === '' && agents && agents.length === 0 && <p className="hint wizard-note">برای ساخت از روی Confluence به یک Agent فعال نیاز است.</p>}
      </div>
    </div>
  );
}

/** Seconds since `active` last became true, ticking once a second while it stays true. */
function useElapsed(active: boolean) {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return setStartedAt(null);
    const t0 = Date.now();
    setStartedAt(t0);
    setNow(t0);
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return startedAt === null ? null : Math.max(0, Math.floor((now - startedAt) / 1000));
}

const clock = (s: number) => `${fa(Math.floor(s / 60))}:${fa(s % 60).padStart(2, '۰')}`;

type ActivityState = 'done' | 'active' | 'wait' | 'failed' | 'todo';

/** The workflow as a live checklist: what is done, what is running now (with elapsed time) and what comes next. */
function ActivityList({ job, phase, genError, elapsed }: { job: JobView; phase: Phase; genError: string | null; elapsed: number | null }) {
  const failed = job.status === 'failed';
  const reading = job.status === 'retrieving';
  const checking = job.status === 'checking';
  const deciding = job.status === 'awaiting-decision';
  const generating = phase === 'generating';
  const items: { title: string; detail?: React.ReactNode; state: ActivityState }[] = [
    { title: 'بررسی Agent', detail: <bdi>{job.agentName}</bdi>, state: 'done' },
    {
      title: 'خواندن صفحات Confluence',
      detail: reading ? (
        <>
          {fa(job.progress.read)} صفحه{job.progress.current && <> — <bdi>{job.progress.current}</bdi></>}
        </>
      ) : (
        `${fa(job.pages.length)} صفحه`
      ),
      state: reading ? (failed ? 'failed' : 'active') : failed && !job.pages.length ? 'failed' : 'done',
    },
    {
      title: 'بررسی Seed Data تکراری',
      detail: checking ? `مقایسه با ${fa(job.seedEntries)} Seed Data موجود` : deciding ? (job.duplicates.length ? 'Seed Data مشابه پیدا شد؛ تصمیم با شماست' : 'مورد مشابهی پیدا نشد') : undefined,
      state: reading ? 'todo' : checking ? (failed ? 'failed' : 'active') : deciding ? 'wait' : failed ? 'failed' : 'done',
    },
    {
      title: 'ساخت Seed Data',
      detail: generating ? (
        <>
          <bdi>{job.agentName}</bdi> طبق Skill و {fa(job.context?.included.length ?? 0)} صفحهٔ مستندات
        </>
      ) : undefined,
      state: generating ? (genError ? 'failed' : 'active') : job.status === 'ready' ? 'active' : 'todo',
    },
  ];
  // A failure is shown on the step that was running.
  if (failed && !items.some((i) => i.state === 'failed')) items[1].state = 'failed';
  return (
    <ol className="activity" aria-label="پیشرفت">
      {items.map((it) => (
        <li key={it.title} className={`activity-${it.state}`} role={it.state === 'active' ? 'status' : undefined}>
          <span className="activity-icon" aria-hidden="true">
            {it.state === 'done' ? '✓' : it.state === 'active' ? <span className="spinner" /> : it.state === 'failed' ? '✕' : it.state === 'wait' ? '!' : ''}
          </span>
          <span className="activity-text">
            <b>{it.title}</b>
            {it.detail && <small>{it.detail}</small>}
          </span>
          {it.state === 'active' && elapsed !== null && <span className="activity-time">{clock(elapsed)}</span>}
        </li>
      ))}
    </ol>
  );
}

function DecisionView({
  job,
  target,
  setTarget,
  decide,
}: {
  job: JobView;
  target: string;
  setTarget: (id: string) => void;
  decide: (action: 'cancel' | 'new' | 'overwrite') => void;
}) {
  const pagesWithMatches = [...new Map(job.duplicates.map((d) => [d.pageId, d])).values()];
  return (
    <div className="stack">
      {(job.excludedReferences?.length ?? 0) > 0 && (
        <p className="hint">
          <ReferenceNote job={job} />
        </p>
      )}

      {(job.failures.length > 0 || job.skippedByLimit > 0) && (
        <div className="warn-box" role="alert">
          <b>همهٔ صفحات خوانده نشد:</b>
          <ul>
            {job.failures.map((f, i) => (
              <li key={i}>
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noopener noreferrer">
                    {f.title ?? f.id}
                  </a>
                ) : (
                  (f.title ?? f.id)
                )}{' '}
                ({f.what === 'children' ? 'فهرست زیرصفحه‌ها' : 'صفحه'}): {f.reason}
              </li>
            ))}
            {job.skippedByLimit > 0 && <li>{fa(job.skippedByLimit)} صفحهٔ دیگر به‌دلیل سقف تعداد یا عمق صفحات خوانده نشد.</li>}
          </ul>
        </div>
      )}

      {job.duplicates.length > 0 ? (
        <>
          <div className="decision-head">
            <h3>Seed Data مشابه در Confluence پیدا شد.</h3>
            <p className="hint">پیشنهاد می‌شود Seed Data تکراری نسازید. اگر یکی از این‌ها همان چیزی است که لازم دارید، آن را برای بازنویسی انتخاب کنید.</p>
          </div>
          <ul className="duplicates">
            {job.duplicates.map((d, i) => (
              <li key={`${d.pageId}-${d.seedDataId ?? i}`} className={`duplicate ${target === d.pageId ? 'selected' : ''}`}>
                <label>
                  <input type="radio" name="overwrite-target" aria-label={`بازنویسی ${d.pageTitle}`} checked={target === d.pageId} onChange={() => setTarget(d.pageId)} />
                  <span className="stack-tight">
                    <span>
                      <a href={d.pageUrl} target="_blank" rel="noopener noreferrer">
                        {d.pageTitle}
                      </a>
                      {d.seedDataId && <bdi className="mono"> · {d.seedDataId}</bdi>} <span className={`badge ${d.similarity === 'medium' ? '' : 'bad'}`}>{SIMILARITY[d.similarity]}</span>
                    </span>
                    <small dir="auto">{d.explanation}</small>
                    {d.matchingFields.length > 0 && <small>موارد مشابه: {d.matchingFields.join('، ')}</small>}
                    {d.lastUpdated && (
                      <small>
                        آخرین تغییر: {fmtDate(d.lastUpdated)}
                        {d.updatedBy ? ` توسط ${d.updatedBy}` : ''}
                      </small>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="decision-actions">
            <button type="button" className="btn" onClick={() => decide('cancel')}>
              ساخته نشود
            </button>
            <button type="button" className="btn" onClick={() => decide('new')}>
              ساخت به‌عنوان Seed Data جدید
            </button>
            <button type="button" className="btn btn-primary" onClick={() => decide('overwrite')} disabled={!target}>
              بازنویسی صفحهٔ انتخاب‌شده{pagesWithMatches.length > 1 && !target ? ' (یکی را انتخاب کنید)' : ''}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="decision-head ok">
            <h3>✓ Seed Data مشابهی پیدا نشد.</h3>
            <p className="hint">می‌توانید با صفحات خوانده‌شده Seed Data جدید بسازید.</p>
          </div>
          <div className="decision-actions">
            <button type="button" className="btn" onClick={() => decide('cancel')}>
              لغو
            </button>
            <button type="button" className="btn btn-primary" onClick={() => decide('new')}>
              ادامه با صفحات خوانده‌شده
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** Says which reference pages of the guide were read but left out of the duplicate comparison. */
function ReferenceNote({ job }: { job: JobView }) {
  const refs = job.excludedReferences ?? [];
  if (!refs.length) return null;
  return (
    <>
      {' '}
      صفحهٔ مرجع راهنما{' '}
      {refs.map((r, i) => (
        <span key={r.id}>
          {i > 0 && '، '}
          <a href={r.url} target="_blank" rel="noopener noreferrer">
            {r.title}
          </a>
        </span>
      ))}{' '}
      فقط به‌عنوان نمونهٔ ساختار خوانده شد و در مقایسهٔ تکراری‌ها لحاظ نشد.
    </>
  );
}

/** Confluence-like rendering in a sandboxed frame: page content (ours or from Confluence) can never run scripts here. */
function StorageFrame({ title, storage }: { title: string; storage: string }) {
  return <iframe className="storage-frame" title={title} sandbox="" srcDoc={previewDocument(storage)} />;
}
