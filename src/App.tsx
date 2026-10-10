import { useEffect, useMemo, useRef, useState } from 'react';
import { useDialogs } from './components/Dialogs';
import { ExportPanel } from './components/ExportPanel';
import { SavedItemBar } from './components/SavedItemBar';
import { SettingsDialog } from './components/SettingsDialog';
import { StandardEditor } from './components/StandardEditor';
import { TableEditor } from './components/TableEditor';
import { TemplateEditor } from './components/TemplateEditor';
import { useToast } from './components/Toasts';
import { ValidationPanel } from './components/ValidationPanel';
import { exampleInput } from './lib/defaults';
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
  return 'Basic (offline, no AI)';
}

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
        title: 'Discard unsaved changes?',
        message: `“${draft.name || `Untitled ${noun}`}” has changes that are not saved.`,
        confirmLabel: 'Discard changes',
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
        if (!draft.name.trim()) return notify('error', `Give the ${noun} a name before saving.`);
        const item = { ...draft, name: draft.name.trim(), updatedAt: nowIso() };
        set(saved ? list.map((i) => (i.id === item.id ? item : i)) : [...list, item], item);
        notify('success', `Saved ${noun} “${item.name}”.`);
      },
      rename: async () => {
        const name = await prompt({ title: `Rename ${noun}`, label: 'New name', initialValue: draft.name, confirmLabel: 'Rename' });
        if (!name) return;
        set(
          list.map((i) => (i.id === draft.id ? { ...i, name, updatedAt: nowIso() } : i)),
          { ...draft, name },
        );
        notify('success', `Renamed to “${name}”.`);
      },
      duplicate: () => {
        const copy = { ...structuredClone(draft), id: newId(listKey === 'standards' ? 'std' : 'tpl'), name: `${draft.name || noun} (copy)`, updatedAt: nowIso() };
        set([...list, copy], copy);
        notify('success', `Created “${copy.name}”.`);
      },
      remove: async () => {
        if (!saved) return;
        const ok = await confirm({
          title: `Delete ${noun}?`,
          message: `“${saved.name}” will be permanently deleted. Tables you already generated are not affected.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        const rest = list.filter((i) => i.id !== saved.id);
        set(rest, rest[0] ? structuredClone(rest[0]) : blank());
        notify('success', `Deleted “${saved.name}”.`);
      },
    };
  }

  const std = collectionActions<Standard>('standards', 'standardDraft', blankStandard, 'standard');
  const tpl = collectionActions<Template>('templates', 'templateDraft', blankTemplate, 'template');

  // ---- Generation --------------------------------------------------------------------------
  const problems = templateProblems(ws.templateDraft);

  const generate = async () => {
    setGenError(null);
    if (!ws.input.trim()) {
      setGenError('Add some input text first — the table is generated from it.');
      return;
    }
    if (problems.length) {
      setGenError(problems.join(' '));
      return;
    }
    if (ws.table && ws.table.rows.length > 0) {
      const ok = await confirm({
        title: 'Replace the current table?',
        message: 'The generated table below will be replaced. Use “Save table” first if you want to keep it. If generation fails, the current table is kept.',
        confirmLabel: 'Generate new table',
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
      notify('success', `Generated ${table.rows.length} row${table.rows.length === 1 ? '' : 's'}${v.errors.length ? ` — ${v.errors.length} validation error${v.errors.length === 1 ? '' : 's'} to fix` : ''}.`);
      requestAnimationFrame(() => tableRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      if (controller.signal.aborted) notify('info', 'Generation cancelled. Nothing was changed.');
      else {
        const message = err instanceof GenerationError ? err.message : 'Something went wrong while generating.';
        setGenError(`${message} Your input and current table were not changed.`);
        notify('error', 'Generation failed.');
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
    const name = await prompt({ title: 'Save table', label: 'Name', initialValue: `${ws.templateDraft.name} – ${new Date().toLocaleDateString()}`, confirmLabel: 'Save' });
    if (!name) return;
    update((w) => ({ savedTables: [...w.savedTables, { id: newId('tbl'), name, table: structuredClone(w.table!), savedAt: nowIso() }] }));
    notify('success', `Saved table “${name}”.`);
  };

  const openSavedTable = async (id: string) => {
    const saved = ws.savedTables.find((t) => t.id === id);
    if (!saved) return;
    if (ws.table && ws.table.rows.length > 0) {
      const ok = await confirm({ title: 'Open saved table?', message: 'The table currently in the editor will be replaced.', confirmLabel: 'Open' });
      if (!ok) return;
    }
    setTable(structuredClone(saved.table));
    notify('success', `Opened “${saved.name}”.`);
  };

  const deleteSavedTable = async (id: string) => {
    const saved = ws.savedTables.find((t) => t.id === id);
    if (!saved) return;
    const ok = await confirm({ title: 'Delete saved table?', message: `“${saved.name}” will be permanently deleted.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    update((w) => ({ savedTables: w.savedTables.filter((t) => t.id !== id) }));
    notify('success', 'Saved table deleted.');
  };

  const updateTemplateFromTable = async () => {
    if (!ws.table) return;
    const ok = await confirm({
      title: 'Update the template?',
      message: `The columns of “${ws.templateDraft.name}” will be replaced with the ${ws.table.columns.length} columns of this table, and the template will be saved.`,
      confirmLabel: 'Update template',
    });
    if (!ok) return;
    update((w) => {
      const item = { ...w.templateDraft, columns: structuredClone(w.table!.columns), updatedAt: nowIso() };
      const exists = w.templates.some((t) => t.id === item.id);
      return { templateDraft: item, templates: exists ? w.templates.map((t) => (t.id === item.id ? item : t)) : [...w.templates, item] };
    });
    notify('success', 'Template updated from the table.');
  };

  const clearTable = async () => {
    const ok = await confirm({ title: 'Clear the table?', message: 'The generated table will be removed from the editor. Saved tables are not affected.', confirmLabel: 'Clear', danger: true });
    if (ok) setTable(null);
  };

  const validateNow = () => {
    setShowValidation(true);
    if (validation) notify(validation.ok ? 'success' : 'error', validation.ok ? 'Validation passed — no errors.' : `${validation.errors.length} validation error${validation.errors.length === 1 ? '' : 's'} found.`);
  };

  const tableName = ws.templateDraft.name || 'table';

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>Local Table Generator</h1>
          <p className="tagline">Standard → structure → input → table → Confluence</p>
        </div>
        <button type="button" className="btn provider-chip" onClick={() => setSettingsOpen(true)} title="Choose how tables are generated">
          <span className={`dot ${ws.settings.provider === 'basic' ? 'off' : 'on'}`} aria-hidden="true" />
          {providerLabel(ws.settings)} · Settings
        </button>
      </header>

      <main>
        <div className="two-col">
          <Section step={1} title="Standard" hint="The rules every generated table must follow. Saved standards can be reused.">
            <SavedItemBar
              noun="standard"
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
          </Section>

          <Section step={2} title="Table structure" hint="Columns in the exact order they should appear. Checked rules are validated automatically.">
            <SavedItemBar
              noun="template"
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
          </Section>
        </div>

        <Section step={3} title="Input" hint="Paste requirements, notes, user stories, acceptance criteria or a rough table.">
          <textarea
            className="input-area"
            value={ws.input}
            onChange={(e) => update({ input: e.target.value })}
            placeholder="Paste your source text here…"
            aria-label="Input text"
            rows={10}
          />
          <div className="row-between">
            <span className="hint">{ws.input.trim() ? `${ws.input.length.toLocaleString()} characters` : 'Input is empty.'}</span>
            <div className="btn-group">
              <button
                type="button"
                className="btn btn-sm"
                onClick={async () => {
                  if (!ws.input.trim() || (await confirm({ title: 'Replace input?', message: 'The current input will be replaced with the example text.', confirmLabel: 'Use example' }))) update({ input: exampleInput });
                }}
              >
                Use example
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={!ws.input}
                onClick={async () => {
                  if (await confirm({ title: 'Clear input?', message: 'The input text will be removed.', confirmLabel: 'Clear', danger: true })) update({ input: '' });
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <div className="generate-bar">
            <button type="button" className="btn btn-primary btn-lg" onClick={generate} disabled={!!busy}>
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Generating…
                </>
              ) : (
                'Generate table'
              )}
            </button>
            {busy && (
              <button type="button" className="btn" onClick={() => busy.abort()}>
                Cancel
              </button>
            )}
            <span className="hint">
              Using <b>{providerLabel(ws.settings)}</b> with “{std.draft.name || 'Untitled standard'}” and “{tpl.draft.name || 'Untitled template'}”.
              {ws.settings.provider === 'basic' && (
                <>
                  {' '}
                  Offline mode only copies input lines into rows —{' '}
                  <button type="button" className="link" onClick={() => setSettingsOpen(true)}>
                    set up AI
                  </button>{' '}
                  for real generation.
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

        <Section step={4} title="Review and edit" hint="Edit any cell. Changes here never alter the saved template." ref={tableRef}>
          {!ws.table ? (
            <div className="empty big">
              <p>No table yet.</p>
              <p className="hint">Fill in steps 1–3 and click “Generate table”.</p>
              {ws.savedTables.length > 0 && <SavedTablesPicker tables={ws.savedTables} onOpen={openSavedTable} onDelete={deleteSavedTable} />}
            </div>
          ) : (
            <>
              <div className="toolbar">
                <button type="button" className="btn btn-sm btn-primary" onClick={validateNow}>
                  Validate
                </button>
                <button type="button" className="btn btn-sm" onClick={generate} disabled={!!busy}>
                  Regenerate
                </button>
                <button type="button" className="btn btn-sm" onClick={saveTable}>
                  Save table
                </button>
                <button type="button" className="btn btn-sm" onClick={updateTemplateFromTable} title="Copy this table's columns into the saved template">
                  Update template from table
                </button>
                <button type="button" className="btn btn-sm btn-ghost-danger" onClick={clearTable}>
                  Clear table
                </button>
                {validation && (
                  <span className={`badge ${validation.ok ? 'ok' : 'bad'}`}>
                    {validation.ok ? '✓ No errors' : `${validation.errors.length} error${validation.errors.length === 1 ? '' : 's'}`}
                    {validation.warnings.length ? ` · ${validation.warnings.length} to review` : ''}
                  </span>
                )}
                <span className="hint grow-right">
                  {ws.table.rows.length} rows · {ws.table.source === 'ai' ? 'AI generated' : ws.table.source === 'basic' ? 'Offline generated' : 'Manual'}
                </span>
              </div>
              <TableEditor table={ws.table} issues={validation ? [...validation.errors, ...validation.warnings] : []} onChange={setTable} />
              {showValidation && validation && <ValidationPanel result={validation} notes={ws.table.notes} />}
              {ws.savedTables.length > 0 && <SavedTablesPicker tables={ws.savedTables} onOpen={openSavedTable} onDelete={deleteSavedTable} />}
            </>
          )}
        </Section>

        <Section step={5} title="Copy or export for Confluence" hint="Column names and order are kept exactly as in the table above.">
          {ws.table ? <ExportPanel table={ws.table} name={tableName} hasErrors={!!validation && !validation.ok} /> : <p className="empty">Generate a table first.</p>}
        </Section>
      </main>

      {settingsOpen && (
        <SettingsDialog
          settings={ws.settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(settings) => {
            update({ settings });
            notify('success', `Generation set to ${providerLabel(settings)}.`);
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
          {step}
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
      <summary>Saved tables ({tables.length})</summary>
      <ul>
        {tables.map((t) => (
          <li key={t.id}>
            <span>
              {t.name} <small className="hint">· {t.table.rows.length} rows · {new Date(t.savedAt).toLocaleString()}</small>
            </span>
            <span className="btn-group">
              <button type="button" className="btn btn-sm" onClick={() => onOpen(t.id)}>
                Open
              </button>
              <button type="button" className="btn btn-sm btn-ghost-danger" onClick={() => onDelete(t.id)} aria-label={`Delete saved table ${t.name}`}>
                Delete
              </button>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
