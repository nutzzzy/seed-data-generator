import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}
interface PromptOptions {
  title: string;
  label: string;
  initialValue?: string;
  confirmLabel?: string;
}
interface TextOptions {
  title: string;
  message?: ReactNode;
  text: string;
}

type DialogState =
  | ({ kind: 'confirm'; resolve: (ok: boolean) => void } & ConfirmOptions)
  | ({ kind: 'prompt'; resolve: (value: string | null) => void } & PromptOptions)
  | ({ kind: 'text'; resolve: () => void } & TextOptions);

interface DialogApi {
  confirm: (o: ConfirmOptions) => Promise<boolean>;
  prompt: (o: PromptOptions) => Promise<string | null>;
  showText: (o: TextOptions) => Promise<void>;
}

const DialogContext = createContext<DialogApi | null>(null);

export function useDialogs(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useDialogs must be used inside <DialogProvider>');
  return api;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ kind: 'confirm', ...o, resolve })),
    [],
  );
  const prompt = useCallback(
    (o: PromptOptions) => new Promise<string | null>((resolve) => setState({ kind: 'prompt', ...o, resolve })),
    [],
  );
  const showText = useCallback(
    (o: TextOptions) => new Promise<void>((resolve) => setState({ kind: 'text', ...o, resolve })),
    [],
  );

  const close = () => setState(null);

  return (
    <DialogContext.Provider value={{ confirm, prompt, showText }}>
      {children}
      {state && <DialogView state={state} close={close} />}
    </DialogContext.Provider>
  );
}

function DialogView({ state, close }: { state: DialogState; close: () => void }) {
  const [value, setValue] = useState(state.kind === 'prompt' ? (state.initialValue ?? '') : '');
  const focusRef = useRef<HTMLInputElement & HTMLButtonElement & HTMLTextAreaElement>(null);

  useEffect(() => {
    focusRef.current?.focus();
    if (state.kind !== 'confirm') focusRef.current?.select?.();
  }, [state]);

  const cancel = () => {
    if (state.kind === 'confirm') state.resolve(false);
    else if (state.kind === 'prompt') state.resolve(null);
    else state.resolve();
    close();
  };
  const accept = () => {
    if (state.kind === 'confirm') state.resolve(true);
    else if (state.kind === 'prompt') {
      if (!value.trim()) return;
      state.resolve(value.trim());
    } else state.resolve();
    close();
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onKeyDown={(e) => e.key === 'Escape' && cancel()}
      >
        <h2 id="dialog-title">{state.title}</h2>
        {state.kind === 'confirm' && <div className="dialog-body">{state.message}</div>}
        {state.kind === 'prompt' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              accept();
            }}
          >
            <label className="field">
              <span>{state.label}</span>
              <input ref={focusRef} value={value} onChange={(e) => setValue(e.target.value)} />
            </label>
          </form>
        )}
        {state.kind === 'text' && (
          <>
            {state.message && <div className="dialog-body">{state.message}</div>}
            <textarea ref={focusRef} className="mono" dir="ltr" readOnly rows={10} value={state.text} aria-label={state.title} />
          </>
        )}
        <div className="dialog-actions">
          {state.kind !== 'text' && (
            <button type="button" className="btn" onClick={cancel}>
              انصراف
            </button>
          )}
          <button
            type="button"
            ref={state.kind === 'confirm' ? focusRef : undefined}
            className={`btn ${state.kind === 'confirm' && state.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={accept}
            disabled={state.kind === 'prompt' && !value.trim()}
          >
            {state.kind === 'text' ? 'بستن' : (state.confirmLabel ?? 'تأیید')}
          </button>
        </div>
      </div>
    </div>
  );
}
