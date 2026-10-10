interface Item {
  id: string;
  name: string;
}

interface Props {
  /** Noun shown in labels, e.g. "استاندارد". */
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
        <span className="sr-only">{noun}های ذخیره‌شده</span>
        <select value={isSaved ? activeId : ''} onChange={(e) => e.target.value && onSelect(e.target.value)} aria-label={`${noun}های ذخیره‌شده`}>
          {!isSaved && <option value="">{noun} جدید (هنوز ذخیره نشده)</option>}
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </label>
      <div className="saved-actions">
        <button type="button" className={`btn btn-sm ${dirty ? 'btn-primary' : ''}`} onClick={onSave} disabled={!dirty}>
          {dirty ? 'ذخیره' : 'ذخیره شده'}
        </button>
        <button type="button" className="btn btn-sm" onClick={onNew}>
          جدید
        </button>
        <button type="button" className="btn btn-sm" onClick={onRename}>
          تغییر نام
        </button>
        <button type="button" className="btn btn-sm" onClick={onDuplicate}>
          کپی
        </button>
        <button type="button" className="btn btn-sm btn-ghost-danger" onClick={onDelete} disabled={!isSaved}>
          حذف
        </button>
      </div>
      {dirty && <p className="hint unsaved">تغییرات ذخیره نشده‌اند. در همین مرورگر نگه داشته می‌شوند، اما تا روی «ذخیره» کلیک نکنید در {noun} ذخیره‌شده اعمال نمی‌شوند.</p>}
    </div>
  );
}
