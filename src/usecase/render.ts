/**
 * Mermaid rendering, loaded on demand (the library is large). Labels are drawn as SVG text, not HTML, so the
 * SVG can be turned into the PNG that goes on the Confluence page as the "Rendered Diagram" attachment.
 */
type MermaidApi = typeof import('mermaid').default;

let loading: Promise<MermaidApi> | null = null;
let counter = 0;

function load(): Promise<MermaidApi> {
  loading ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: false },
      fontFamily: 'Vazirmatn, Tahoma, Arial, sans-serif',
    });
    return mermaid;
  });
  return loading;
}

export class MermaidSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MermaidSyntaxError';
  }
}

export async function renderMermaid(source: string): Promise<string> {
  const mermaid = await load();
  try {
    await mermaid.parse(source);
  } catch (err) {
    throw new MermaidSyntaxError(err instanceof Error ? err.message : String(err));
  }
  const { svg } = await mermaid.render(`uc-diagram-${++counter}`, source);
  return svg;
}

/** SVG markup → PNG (base64 data URL), white background, scaled for sharpness. */
export async function svgToPng(svg: string, scale = 2): Promise<string> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.documentElement;
  const box = el.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const width = box?.[2] || parseFloat(el.getAttribute('width') ?? '') || 800;
  const height = box?.[3] || parseFloat(el.getAttribute('height') ?? '') || 600;
  el.setAttribute('width', String(width));
  el.setAttribute('height', String(height));
  const markup = new XMLSerializer().serializeToString(el);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('تبدیل نمودار به تصویر ناموفق بود.'));
    img.src = url;
  });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * scale);
  canvas.height = Math.ceil(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas در این مرورگر در دسترس نیست.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

export async function mermaidToPng(source: string): Promise<string> {
  return svgToPng(await renderMermaid(source));
}

export function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
