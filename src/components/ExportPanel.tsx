import { copyRich, copyText, downloadFile } from '../lib/clipboard';
import { safeFileName, toConfluenceWiki, toCsv, toHtml, toHtmlDocument, toMarkdown, toTsv, type TableData } from '../lib/exporters';
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
  const disabled = table.columns.length === 0;

  const copy = async (label: string, run: () => Promise<boolean>, text: string) => {
    if (await run()) notify('success', `${label} copied to the clipboard.`);
    else await showText({ title: label, message: 'Your browser blocked clipboard access. Select the text below and copy it with Ctrl/⌘+C.', text });
  };

  return (
    <div className="export">
      {hasErrors && <p className="hint warn">The table still has validation errors. You can export anyway.</p>}
      <div className="export-grid">
        <ExportOption
          title="Copy for Confluence"
          detail="Recommended. Copies a formatted table; paste it into the Confluence editor with Ctrl/⌘+V."
          primary
          disabled={disabled}
          onClick={() => copy('Table', () => copyRich(toHtml(table), toTsv(table)), toHtml(table))}
        />
        <ExportOption
          title="Copy as HTML"
          detail="HTML source of the table, for HTML macros or other tools."
          disabled={disabled}
          onClick={() => copy('HTML', () => copyText(toHtml(table)), toHtml(table))}
        />
        <ExportOption
          title="Copy as Confluence wiki markup"
          detail="For Insert → Markup (Cloud) or the wiki markup editor (Data Center / Server)."
          disabled={disabled}
          onClick={() => copy('Wiki markup', () => copyText(toConfluenceWiki(table)), toConfluenceWiki(table))}
        />
        <ExportOption
          title="Copy as Markdown"
          detail="Markdown table. Some Confluence editors convert it on paste or via Insert → Markup; others keep it as text."
          disabled={disabled}
          onClick={() => copy('Markdown', () => copyText(toMarkdown(table)), toMarkdown(table))}
        />
        <ExportOption
          title="Download CSV"
          detail="UTF-8 file for Excel, Google Sheets, Numbers."
          disabled={disabled}
          onClick={() => {
            downloadFile(safeFileName(name, 'csv'), toCsv(table), 'text/csv;charset=utf-8');
            notify('success', 'CSV file downloaded.');
          }}
        />
        <ExportOption
          title="Download HTML"
          detail="A plain .html page containing the table."
          disabled={disabled}
          onClick={() => {
            downloadFile(safeFileName(name, 'html'), toHtmlDocument(table, name), 'text/html;charset=utf-8');
            notify('success', 'HTML file downloaded.');
          }}
        />
      </div>
      <details className="help">
        <summary>How to get the table into Confluence</summary>
        <ol>
          <li>Click <b>Copy for Confluence</b>.</li>
          <li>In Confluence, edit the page, click where the table should go and paste (Ctrl/⌘+V).</li>
          <li>Check the pasted table. Line breaks inside cells and header styling can differ between Confluence versions and editors.</li>
          <li>If the paste comes out as plain text, use <b>Copy as Confluence wiki markup</b> and insert it with <i>Insert → Markup</i>, or import the CSV.</li>
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
