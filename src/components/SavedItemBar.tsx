interface Item {
  id: string;
  name: string;
}

interface Props {
  /** Singular noun shown in labels, e.g. "standard". */
  noun: string;
  items: Item[];
  activeId: string;
  dirty: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSave: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

/** Select / New / Save / Rename / Duplicate / Delete for saved standards and templates. */
export function SavedItemBar({ noun, items, activeId, dirty, onSelect, onNew, onSave, onRename, onDuplicate, onDelete }: Props) {
  const isSaved = items.some((i) => i.id === activeId);
  return (
    <div className="saved-bar">
      <label className="saved-select">
        <span className="sr-only">Saved {noun}</span>
        <select value={isSaved ? activeId : ''} onChange={(e) => e.target.value && onSelect(e.target.value)} aria-label={`Saved ${noun}s`}>
          {!isSaved && <option value="">New {noun} (not saved yet)</option>}
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      <div className="saved-actions">
        <button type="button" className={`btn btn-sm ${dirty ? 'btn-primary' : ''}`} onClick={onSave} disabled={!dirty}>
          {dirty ? 'Save' : 'Saved'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onNew}>
          New
        </button>
        <button type="button" className="btn btn-sm" onClick={onRename}>
          Rename
        </button>
        <button type="button" className="btn btn-sm" onClick={onDuplicate}>
          Duplicate
        </button>
        <button type="button" className="btn btn-sm btn-ghost-danger" onClick={onDelete} disabled={!isSaved}>
          Delete
        </button>
      </div>
      {dirty && <p className="hint unsaved">Unsaved changes — they are kept in this browser, but not in the saved {noun} until you click Save.</p>}
    </div>
  );
}
