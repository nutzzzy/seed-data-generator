/**
 * Clipboard helpers. The async Clipboard API is used when available (localhost counts as a secure context);
 * otherwise a hidden element + execCommand('copy') fallback is used. Both return false instead of throwing,
 * so the UI can show the text for manual copying.
 */

export async function copyRich(html: string, plain: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  return legacyCopy((holder) => {
    holder.innerHTML = html;
  });
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return legacyCopy((holder) => {
    const pre = document.createElement('pre');
    pre.textContent = text;
    holder.appendChild(pre);
  });
}

function legacyCopy(fill: (holder: HTMLElement) => void): boolean {
  const holder = document.createElement('div');
  holder.setAttribute('contenteditable', 'true');
  holder.style.position = 'fixed';
  holder.style.left = '-10000px';
  holder.style.top = '0';
  fill(holder);
  document.body.appendChild(holder);
  try {
    const range = document.createRange();
    range.selectNodeContents(holder);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    sel?.removeAllRanges();
    return ok;
  } catch {
    return false;
  } finally {
    holder.remove();
  }
}

export function downloadFile(fileName: string, content: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
