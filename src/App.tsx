import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogs } from './components/Dialogs';
import { ExportPanel } from './components/ExportPanel';
import { GuidePanel } from './components/GuidePanel';
import { SavedItemBar } from './components/SavedItemBar';
import { SettingsDialog } from './components/SettingsDialog';
import { StandardEditor } from './components/StandardEditor';
import { TableEditor } from './components/TableEditor';
import { TemplateEditor } from './components/TemplateEditor';
import { useToast } from './components/Toasts';
import { ValidationPanel } from './components/ValidationPanel';
import { seedDataInput } from './lib/defaults';
import { generateTable, GenerationError, type AiTransport } from './lib/generate';
import { newId, nowIso } from './lib/ids';
import { blankStandard, blankTemplate, sameContent, templateProblems } from './lib/model';
import { loadWorkspace, saveWorkspace } from './lib/storage';
import type { GeneratedTable, Settings, Standard, Template, Workspace } from './lib/types';
import { validateTable } from './lib/validate';

interface Props {
  /** Injected in tests; defaults to the local server endpoint. */
  transport?: AiTransport;
}

type Named = { id: string; name: string; updatedAt: string };

export function providerLabel(s: Settings): string {
  if (s.provider === 'claude-code') return `Claude Code${s.claudeCodeModel ? ` · ${s.claudeCodeModel}` : ''}`;
  if (s.provider === 'anthropic') return `Claude · ${s.anthropicModel}`;
  if (s.provider === 'ollama') return `Ollama · ${s.ollamaModel}`;
  return 'ساده (آفلاین)';
}

const count = (n: number, noun: string) => `${n} ${noun}`;

export default function App({ transport }: Props) {
  const [loaded] = useState(() => loadWorkspace());
  const [ws, setWs] = useState<Workspace>(loaded.workspace);
  const [busy, setBusy] = useState<AbortController | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { confirm, prompt } = useDialogs();
  const notify = useToast();
  const tableRef = useRef<HTMLElement>(null);
  const storageError = useRef<string | null>(null);

  useEffect(() => {
    if (loaded.warning) notify('error', loaded.warning);
  }, [loaded, notify]);

  // Persist every change (debounced) so work survives reloads and restarts.
  useEffect(() => {
    const t = setTimeout(() => {
      const err = saveWorkspace(ws);
      if (err && err !== storageError.current) notify('error', err);
      storageError.current = err;
    }, 250);
    return () => clearTimeout(t);
  }, [ws, notify]);

  const update = (patch: Partial<Workspace> | ((w: Workspace) => Partial<Workspace>)) =>
    setWs((w) => ({ ...w, ...(typeof patch === 'function' ? patch(w) : patch) }));

  // ---- Saved standards / templates ------------------------------------------------------
  function collectionActions<T extends Named>(listKey: 'standards' | 'templates', draftKey: 'standardDraft' | 'templateDraft', blank: () => T, noun: string) {
    const list = ws[listKey] as unknown as T[];
    const draft = ws[draftKey] as unknown as T;
    const saved = list.find((i) => i.id === draft.id);
    const dirty = !sameContent(draft, saved);
    const set = (nextList: T[], nextDraft: T) => update({ [listKey]: nextList, [draftKey]: nextDraft } as Partial<Workspace>);

    const okToLeave = async () =>
      !dirty ||
      confirm({
        title: 'تغییرات ذخیره‌نشده حذف شوند؟',
        message: `«${draft.name || noun}» تغییراتی دارد که ذخیره نشده‌اند.`,
        confirmLabel: 'حذف تغییرات',
        danger: true,
      });

    return {
      list,
      draft,
      dirty,
      setDraft: (d: T) => update({ [draftKey]: d } as Partial<Workspace>),
      select: async (id: string) => {
        const item = list.find((i) => i.id === id);
        if (item && (await okToLeave())) update({ [draftKey]: structuredClone(item) } as Partial<Workspace>);
      },
      create: async () => {
        if (await okToLeave()) update({ [draftKey]: blank() } as Partial<Workspace>);
      },
      save: () => {
        if (!draft.name.trim()) return notify('error', `قبل از ذخیره، برای ${noun} نام انتخاب کنید.`);
        const item = { ...draft, name: draft.name.trim(), updatedAt: nowIso() };
        set(saved ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item], item);
        notify('success', `${noun} «${item.name}» ذخیره شد.`);
      },
      rename: async () => {
        const name = await prompt({ title: `تغییر نام ${noun}`, label: 'نام جدید', initialValue: draft.name, confirmLabel: 'تغییر نام' });
        if (!name) return;
        set(
          list.map((i) => (i.id === draft.id ? { ...i, name, updatedAt: nowIso() } : i)),
          { ...draft, name },
        );
        notify('success', `نام به «${name}» تغییر کرد.`);
      },
      duplicate: () => {
        const copy = { ...structuredClone(draft), id: newId(listKey === 'standards' ? 'std' : 'tpl'), name: `${draft.name || noun} (کپی)`, updatedAt: nowIso() };
        set([...list, copy], copy);
        notify('success', `«${copy.name}» ساخته شد.`);
      },
      remove: async () => {
        if (!saved) return;
        const ok = await confirm({
          title: `${noun} حذف شود؟`,
          message: `«${saved.name}» برای همیشه حذف می‌شود. جدول‌هایی که قبلاً ساخته‌اید تغییری نمی‌کنند.`,
          confirmLabel: 'حذف',
          danger: true,
        });
        if (!ok) return;
        const rest = list.filter((i) => i.id !== saved.id);
        set(rest, rest[0] ? structuredClone(rest[0]) : blank());
        notify('success', `«${saved.name}» حذف شد.`);
      },
    };
  }

  const std = collectionActions<Standard>('standards', 'standardDraft', () => blankStandard('استاندارد جدید'), 'استاندارد');
  const tpl = collectionActions<Template>('templates', 'templateDraft', () => blankTemplate('ساختار جدید'), 'ساختار جدول');

  // ---- Generation --------------------------------------------------------------------------
  const problems = templateProblems(ws.templateDraft);

  const generate = async () => {
    setGenError(null);
    if (!ws.input.trim()) {
      setGenError('ابتدا نیازمندی‌ها یا یادداشت‌ها را وارد کنید؛ Seed Data از روی آن‌ها ساخته می‌شود.');
      return;
    }
    if (problems.length) {
      setGenError(problems.join(' '));
      return;
    }
    if (ws.table && ws.table.rows.length > 0) {
      const ok = await confirm({
        title: 'Seed Dataهای فعلی جایگزین شوند؟',
        message: 'جدول فعلی با نتیجهٔ جدید جایگزین می‌شود. اگر می‌خواهید نگهش دارید، اول «ذخیره» را بزنید. اگر ساخت ناموفق باشد، جدول فعلی دست نمی‌خورد.',
        confirmLabel: 'ساخت دوباره',
      });
      if (!ok) return;
    }
    const controller = new AbortController();
    setBusy(controller);
    try {
      const table = await generateTable({
        standard: ws.standardDraft,
        template: ws.templateDraft,
        input: ws.input,
        settings: ws.settings,
        signal: controller.signal,
        transport,
      });
      update({ table });
      setShowValidation(true);
      const v = validateTable(table, ws.templateDraft, ws.standardDraft);
      notify('success', `${count(table.rows.length, 'Seed Data')} ساخته شد${v.errors.length ? ` — ${count(v.errors.length, 'خطا')} برای رفع` : ''}.`);
      requestAnimationFrame(() => tableRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      if (controller.signal.aborted) notify('info', 'ساخت لغو شد. چیزی تغییر نکرد.');
      else {
        const message = err instanceof GenerationError ? err.message : 'هنگام ساخت مشکلی پیش آمد.';
        setGenError(`${message} ورودی و جدول فعلی شما تغییری نکرد.`);
        notify('error', 'ساخت Seed Data ناموفق بود.');
      }
    } finally {
      setBusy(null);
    }
  };

  // ---- Generated table -----------------------------------------------------------------------
  const validation = useMemo(() => (ws.table ? validateTable(ws.table, ws.templateDraft, ws.standardDraft) : null), [ws.table, ws.templateDraft, ws.standardDraft]);
  const setTable = (table: GeneratedTable | null) => update({ table });

  const saveTable = async () => {
    if (!ws.table) return;
    const name = await prompt({ title: 'ذخیرهٔ Seed Dataها', label: 'نام', initialValue: `Seed Data – ${new Date().toLocaleDateString('fa-IR')}`, confirmLabel: 'ذخیره' });
    if (!name) return;
    update((w) => ({ savedTables: [...w.savedTables, { id: newId('tbl'), name, table: structuredClone(w.table!), savedAt: nowIso() }] }));
    notify('success', `«${name}» ذخیره شد.`);
  };

  const openSavedTable = async (id: string) => {
    const saved = ws.savedTables.find((t) => t.id === id);
    if (!saved) return;
    if (ws.table && ws.table.rows.length > 0) {
      const ok = await confirm({ title: 'باز کردن جدول ذخیره‌شده؟', message: 'جدولی که الان در حال ویرایش است جایگزین می‌شود.', confirmLabel: 'باز کردن' });
      if (!ok) return;
    }
    setTable(structuredClone(saved.table));
    notify('success', `«${saved.name}» باز شد.`);
  };

  const deleteSavedTable = async (id: string) => {
    const saved = ws.savedTables.find((t) => t.id === id);
    if (!saved) return;
    const ok = await confirm({ title: 'جدول ذخیره‌شده حذف شود؟', message: `«${saved.name}» برای همیشه حذف می‌شود.`, confirmLabel: 'حذف', danger: true });
    if (!ok) return;
    update((w) => ({ savedTables: w.savedTables.filter((t) => t.id !== id) }));
    notify('success', 'جدول ذخیره‌شده حذف شد.');
  };

  const updateTemplateFromTable = async () => {
    if (!ws.table) return;
    const ok = await confirm({
      title: 'ساختار جدول به‌روز شود؟',
      message: `ستون‌های «${ws.templateDraft.name}» با ${ws.table.columns.length} ستون همین جدول جایگزین و ذخیره می‌شوند.`,
      confirmLabel: 'به‌روزرسانی ساختار',
    });
    if (!ok) return;
    update((w) => {
      const item = { ...w.templateDraft, columns: structuredClone(w.table!.columns), updatedAt: nowIso() };
      const exists = w.templates.some((t) => t.id === item.id);
      return { templateDraft: item, templates: exists ? w.templates.map((t) => (t.id === item.id ? item : t)) : [...w.templates, item] };
    });
    notify('success', 'ساختار جدول از روی جدول فعلی به‌روز شد.');
  };

  const clearTable = async () => {
    const ok = await confirm({ title: 'جدول پاک شود؟', message: 'Seed Dataهای ساخته‌شده از صفحه پاک می‌شوند. جدول‌های ذخیره‌شده تغییری نمی‌کنند.', confirmLabel: 'پاک کردن', danger: true });
    if (ok) setTable(null);
  };

  const validateNow = () => {
    setShowValidation(true);
    if (validation) notify(validation.ok ? 'success' : 'error', validation.ok ? 'Checklist بررسی شد؛ خطایی پیدا نشد.' : `${count(validation.errors.length, 'خطا')} پیدا شد.`);
  };

  const sourceLabel = { ai: 'ساخته‌شده با AI', basic: 'ساخته‌شده به‌صورت آفلاین', manual: 'دستی' } as const;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>تولید Seed Data برای QA</h1>
          <p className="tagline">طبق راهنمای Seed Data تیم QA — آماده برای Confluence و Reference در Zephyr</p>
        </div>
        <button type="button" className="btn provider-chip" onClick={() => setSettingsOpen(true)} title="انتخاب روش ساخت Seed Data">
          <span className={`dot ${ws.settings.provider === 'basic' ? 'off' : 'on'}`} aria-hidden="true" />
          {providerLabel(ws.settings)} · تنظیمات
        </button>
      </header>

      <main>
        <GuidePanel />

        <Section step={1} title="نیازمندی‌ها و یادداشت‌ها" hint="داده‌هایی را که تست‌ها لازم دارند توضیح دهید: Feature، Entityها، وضعیت‌ها (Status)، محیط (Environment)، Test Caseهای مرتبط و روش ساخت.">
          <textarea
            className="input-area"
            dir="rtl"
            value={ws.input}
            onChange={(e) => update({ input: e.target.value })}
            placeholder="مثلاً: برای تست Order Management در UAT یک Vendor فعال و یک Order در وضعیت Pending لازم داریم…"
            aria-label="متن ورودی"
            rows={10}
          />
          <div className="row-between">
            <span className="hint">{ws.input.trim() ? `${ws.input.length.toLocaleString('fa-IR')} کاراکتر` : 'ورودی خالی است.'}</span>
            <div className="btn-group">
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  if (!ws.input.trim() || (await confirm({ title: 'جایگزینی ورودی؟', message: 'متن فعلی با متن نمونه جایگزین می‌شود.', confirmLabel: 'استفاده از نمونه' }))) update({ input: seedDataInput });
                }}
              >
                متن نمونه
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!ws.input}
                onClick={async () => {
                  if (await confirm({ title: 'پاک کردن ورودی؟', message: 'متن ورودی پاک می‌شود.', confirmLabel: 'پاک کردن', danger: true })) update({ input: '' });
                }}
              >
                پاک کردن
              </button>
            </div>
          </div>

          <div className="generate-bar">
            <button type="button" className="btn btn-primary btn-lg" onClick={generate} disabled={!!busy}>
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" /> در حال ساخت…
                </>
              ) : (
                'ساخت Seed Data'
              )}
            </button>
            {busy && (
              <button type="button" className="btn" onClick={() => busy.abort()}>
                لغو
              </button>
            )}
            <span className="hint">
              با <b>{providerLabel(ws.settings)}</b> و طبق «{std.draft.name || 'استاندارد بدون نام'}». اطلاعاتی که در ورودی نیست ساخته نمی‌شود و با Not specified مشخص
              می‌شود.
              {ws.settings.provider === 'basic' && (
                <>
                  {' '}
                  حالت آفلاین فقط خطوط ورودی را به ردیف تبدیل می‌کند —{' '}
                  <button type="button" className="link" onClick={() => setSettingsOpen(true)}>
                    Claude Code را فعال کنید
                  </button>
                  .
                </>
              )}
            </span>
          </div>
          {genError && (
            <p className="error-box" role="alert">
              {genError}
            </p>
          )}
        </Section>

        <Section step={2} title="بررسی و ویرایش Seed Dataها" hint="هر ردیف یک Seed Data است و همهٔ سلول‌ها قابل ویرایش‌اند. تغییرات اینجا روی استاندارد و ساختار ذخیره‌شده اثری ندارد." ref={tableRef}>
          {!ws.table ? (
            <div className="empty big">
              <p>هنوز Seed Dataای ساخته نشده است.</p>
              <p className="hint">نیازمندی‌ها را در مرحلهٔ ۱ وارد کنید و «ساخت Seed Data» را بزنید.</p>
              {ws.savedTables.length > 0 && <SavedTablesPicker tables={ws.savedTables} onOpen={openSavedTable} onDelete={deleteSavedTable} />}
            </div>
          ) : (
            <>
              <div className="toolbar">
                <button type="button" className="btn btn-sm btn-primary" onClick={validateNow}>
                  بررسی با Checklist
                </button>
                <button type="button" className="btn btn-sm" onClick={generate} disabled={!!busy}>
                  ساخت دوباره
                </button>
                <button type="button" className="btn btn-sm" onClick={saveTable}>
                  ذخیره
                </button>
                <button type="button" className="btn btn-sm btn-ghost-danger" onClick={clearTable}>
                  پاک کردن جدول
                </button>
                {validation && (
                  <span className={`badge ${validation.ok ? 'ok' : 'bad'}`}>
                    {validation.ok ? '✓ بدون خطا' : count(validation.errors.length, 'خطا')}
                    {validation.warnings.length ? ` · ${count(validation.warnings.length, 'مورد برای بررسی')}` : ''}
                  </span>
                )}
                <span className="hint grow-right">
                  {count(ws.table.rows.length, 'Seed Data')} · {sourceLabel[ws.table.source]}
                </span>
              </div>
              <TableEditor table={ws.table} issues={validation ? [...validation.errors, ...validation.warnings] : []} onChange={setTable} />
              {showValidation && validation && <ValidationPanel table={ws.table} result={validation} notes={ws.table.notes} />}
              {ws.savedTables.length > 0 && <SavedTablesPicker tables={ws.savedTables} onOpen={openSavedTable} onDelete={deleteSavedTable} />}
            </>
          )}
        </Section>

        <Section step={3} title="انتقال به Confluence و Zephyr" hint="جزئیات Seed Data در Confluence نگه داشته می‌شود و Test Caseهای Zephyr فقط به Seed Data ID ارجاع می‌دهند.">
          {ws.table ? (
            <ExportPanel table={ws.table} name={ws.templateDraft.name || 'seed-data'} hasErrors={!!validation && !validation.ok} />
          ) : (
            <p className="empty">اول Seed Data بسازید.</p>
          )}
        </Section>

        <details className="card advanced">
          <summary>
            <strong>تنظیمات پیشرفته: استاندارد و ساختار جدول</strong>
            <span className="hint"> — فقط وقتی راهنمای تیم تغییر کرد</span>
          </summary>
          <div className="two-col">
            <section className="stack" aria-label="استاندارد">
              <h3>استاندارد</h3>
              <p className="hint">قوانینی که هر Seed Data باید رعایت کند. به‌صورت پیش‌فرض، راهنمای Seed Data تیم QA.</p>
              <SavedItemBar
                noun="استاندارد"
                items={std.list}
                activeId={std.draft.id}
                dirty={std.dirty}
                onSelect={std.select}
                onNew={std.create}
                onSave={std.save}
                onRename={std.rename}
                onDuplicate={std.duplicate}
                onDelete={std.remove}
              />
              <StandardEditor standard={std.draft} onChange={std.setDraft} />
            </section>
            <section className="stack" aria-label="ساختار جدول">
              <h3>ساختار جدول</h3>
              <p className="hint">ستون‌ها به همین ترتیب در خروجی Confluence می‌آیند. قوانین بررسی خودکار در Checklist استفاده می‌شوند.</p>
              <SavedItemBar
                noun="ساختار جدول"
                items={tpl.list}
                activeId={tpl.draft.id}
                dirty={tpl.dirty}
                onSelect={tpl.select}
                onNew={tpl.create}
                onSave={tpl.save}
                onRename={tpl.rename}
                onDuplicate={tpl.duplicate}
                onDelete={tpl.remove}
              />
              <TemplateEditor template={tpl.draft} onChange={tpl.setDraft} />
              {ws.table && (
                <button type="button" className="btn btn-sm" onClick={updateTemplateFromTable} title="ستون‌های جدول فعلی را در ساختار ذخیره‌شده قرار می‌دهد">
                  به‌روزرسانی ساختار از روی جدول فعلی
                </button>
              )}
            </section>
          </div>
        </details>
      </main>

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

interface SectionProps {
  step: number;
  title: string;
  hint: string;
  children: React.ReactNode;
  ref?: React.Ref<HTMLElement>;
}

function Section({ step, title, hint, children, ref }: SectionProps) {
  return (
    <section className="card" ref={ref} aria-labelledby={`step-${step}`}>
      <div className="card-head">
        <span className="step" aria-hidden="true">
          {step.toLocaleString('fa-IR')}
        </span>
        <div>
          <h2 id={`step-${step}`}>{title}</h2>
          <p className="hint">{hint}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function SavedTablesPicker({ tables, onOpen, onDelete }: { tables: Workspace['savedTables']; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <details className="saved-tables">
      <summary>Seed Dataهای ذخیره‌شده ({tables.length})</summary>
      <ul>
        {tables.map((t) => (
          <li key={t.id}>
            <span>
              {t.name} <small className="hint">· {count(t.table.rows.length, 'ردیف')} · {new Date(t.savedAt).toLocaleString('fa-IR')}</small>
            </span>
            <span className="btn-group">
              <button type="button" className="btn btn-sm" onClick={() => onOpen(t.id)}>
                باز کردن
              </button>
              <button type="button" className="btn btn-sm btn-ghost-danger" onClick={() => onDelete(t.id)} aria-label={`حذف ${t.name}`}>
                حذف
              </button>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
