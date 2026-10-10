import { copyRich, copyText, downloadFile } from '../lib/clipboard';
import { safeFileName, toConfluenceWiki, toCsv, toHtml, toHtmlDocument, toMarkdown, toTsv, type TableData } from '../lib/exporters';
import { toSeedDataHtml, toSeedDataText, toZephyrReference } from '../lib/seedData';
import { useDialogs } from './Dialogs';
import { useToast } from './Toasts';

interface Props {
  table: TableData;
  name: string;
  hasErrors: boolean;
}

export function ExportPanel({ table, name, hasErrors }: Props) {
  const notify = useToast();
  const { showText } = useDialogs();
  const disabled = table.columns.length === 0 || table.rows.length === 0;
  const reference = toZephyrReference(table);

  const copy = async (label: string, run: () => Promise<boolean>, text: string) => {
    if (await run()) notify('success', `${label} کپی شد.`);
    else await showText({ title: label, message: 'مرورگر اجازهٔ دسترسی به Clipboard را نداد. متن زیر را انتخاب و با Ctrl/⌘+C کپی کنید.', text });
  };
  const download = (ext: 'csv' | 'html', content: string, mime: string) => {
    downloadFile(safeFileName(name, ext), content, mime);
    notify('success', `فایل ${ext.toUpperCase()} دانلود شد.`);
  };

  return (
    <div className="export">
      {hasErrors && <p className="hint warn">جدول هنوز خطای Checklist دارد. می‌توانید خروجی بگیرید، اما بهتر است اول خطاها را برطرف کنید.</p>}

      <h4>Confluence</h4>
      <div className="export-grid">
        <ExportOption
          title="کپی برای Confluence — هر Seed Data جدا"
          detail="پیشنهادی. طبق ساختار راهنما: عنوان Seed Data ID و بعد Name، Purpose، Environment، Data (جدول Field/Value)، Preconditions، How to Create و Used For."
          primary
          disabled={disabled}
          onClick={() => copy('Seed Dataها برای Confluence', () => copyRich(toSeedDataHtml(table), toSeedDataText(table)), toSeedDataHtml(table))}
        />
        <ExportOption
          title="کپی برای Confluence — یک جدول"
          detail="همهٔ Seed Dataها در یک جدول، با همین ستون‌ها و همین ترتیب."
          disabled={disabled}
          onClick={() => copy('جدول', () => copyRich(toHtml(table), toTsv(table)), toHtml(table))}
        />
      </div>

      <h4>Zephyr</h4>
      <div className="zephyr">
        <p className="hint">در Test Case فقط به Seed Data ارجاع دهید؛ جزئیات را کپی نکنید. این متن را در فیلد Test Data یا Precondition قرار دهید.</p>
        {reference ? <pre dir="ltr">{reference}</pre> : <p className="hint warn">هنوز هیچ ردیفی Seed Data ID معتبر ندارد.</p>}
        <button type="button" className="btn btn-sm" disabled={!reference} onClick={() => copy('Reference برای Zephyr', () => copyText(reference), reference)}>
          کپی Reference برای Zephyr
        </button>
      </div>

      <details className="more-formats">
        <summary>فرمت‌های دیگر</summary>
        <div className="export-grid">
          <ExportOption
            title="کپی HTML"
            detail="کد HTML جدول، برای HTML Macro یا ابزارهای دیگر."
            disabled={disabled}
            onClick={() => copy('HTML', () => copyText(toHtml(table)), toHtml(table))}
          />
          <ExportOption
            title="کپی Confluence Wiki Markup"
            detail="برای Insert → Markup در Confluence Cloud یا ویرایشگر Wiki در Data Center / Server."
            disabled={disabled}
            onClick={() => copy('Wiki Markup', () => copyText(toConfluenceWiki(table)), toConfluenceWiki(table))}
          />
          <ExportOption
            title="کپی Markdown"
            detail="جدول Markdown. بعضی نسخه‌های Confluence آن را هنگام Paste به جدول تبدیل می‌کنند و بعضی نه."
            disabled={disabled}
            onClick={() => copy('Markdown', () => copyText(toMarkdown(table)), toMarkdown(table))}
          />
          <ExportOption title="دانلود CSV" detail="فایل UTF-8 برای Excel یا Google Sheets." disabled={disabled} onClick={() => download('csv', toCsv(table), 'text/csv;charset=utf-8')} />
          <ExportOption
            title="دانلود HTML"
            detail="یک فایل HTML ساده شامل جدول."
            disabled={disabled}
            onClick={() => download('html', toHtmlDocument(table, name), 'text/html;charset=utf-8')}
          />
        </div>
      </details>

      <details className="help">
        <summary>نحوهٔ انتقال به Confluence</summary>
        <ol>
          <li>
            روی <b>کپی برای Confluence — هر Seed Data جدا</b> کلیک کنید.
          </li>
          <li>صفحه را در Confluence در حالت ویرایش باز کنید، جای موردنظر کلیک کنید و Paste کنید (Ctrl/⌘+V).</li>
          <li>نتیجه را بررسی کنید. شکل عنوان‌ها، جدول‌ها و شکست خط داخل سلول‌ها ممکن است در نسخه‌ها و ویرایشگرهای مختلف Confluence کمی فرق کند.</li>
          <li>
            اگر متن بدون قالب Paste شد، از <b>کپی Confluence Wiki Markup</b> و <i>Insert → Markup</i> استفاده کنید یا فایل CSV را Import کنید.
          </li>
        </ol>
      </details>
    </div>
  );
}

function ExportOption({ title, detail, onClick, primary, disabled }: { title: string; detail: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`export-option ${primary ? 'primary' : ''}`} onClick={onClick} disabled={disabled}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </button>
  );
}
