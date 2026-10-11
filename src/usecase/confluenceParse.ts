import { newId } from '../lib/ids';
import { blankExtension, blankUseCase } from './model';
import { formatOutline, type OutlineItem } from './outline';
import { UC_HEADINGS } from './rules';
import type { DiagramSection, UseCase } from './types';

/**
 * Reads a Confluence page in any of the forms people have at hand:
 *  - storage format (XHTML with ac:/ri: tags) from the REST API,
 *  - HTML copied from the page in the browser (Ctrl+A, Ctrl+C) and pasted,
 *  - plain text copied from the page.
 * Everything is first flattened into blocks, then read as a Use Case page or as the diagram overview page.
 */

export type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string; links: Link[] }
  | { t: 'list'; ordered: boolean; items: OutlineItem[]; links: Link[] }
  | { t: 'code'; text: string }
  | { t: 'image'; file: string };

interface Link {
  text: string;
  href: string;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

const clean = (s: string) => s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Storage format uses self-closing namespaced tags that an HTML parser would leave open; close them first. */
function storageToHtml(storage: string): string {
  return storage
    .replace(/<((?:ac|ri):[\w-]+)([^>]*?)\s*\/>/g, '<$1$2></$1>')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;'));
}

export function looksLikeHtml(text: string): boolean {
  return /<(p|h[1-6]|ul|ol|table|div|span|ac:[\w-]+)[\s>]/i.test(text);
}

export function toBlocks(content: string): Block[] {
  return looksLikeHtml(content) ? htmlToBlocks(content) : textToBlocks(content);
}

function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(`<body>${storageToHtml(html)}</body>`, 'text/html');
  const blocks: Block[] = [];
  walk(doc.body, blocks);
  return blocks;
}

const tag = (el: Element) => el.tagName.toLowerCase();

function walk(parent: Element, out: Block[]) {
  for (const el of Array.from(parent.children)) {
    const name = tag(el);
    if (/^h[1-6]$/.test(name)) {
      const text = clean(el.textContent ?? '');
      if (text) out.push({ t: 'h', level: Number(name[1]), text });
    } else if (name === 'p') {
      const file = imageIn(el);
      if (file) out.push({ t: 'image', file });
      const text = textOf(el);
      if (text) out.push({ t: 'p', text, links: linksIn(el) });
    } else if (name === 'ul' || name === 'ol') {
      out.push({ t: 'list', ordered: name === 'ol', items: listItems(el), links: linksIn(el) });
    } else if (name === 'table') {
      const cells = Array.from(el.querySelectorAll('td, th'));
      if (cells.length === 1) out.push({ t: 'code', text: textOf(cells[0], true) });
      else for (const row of Array.from(el.querySelectorAll('tr'))) out.push({ t: 'p', text: Array.from(row.children).map((c) => textOf(c)).join(' | '), links: [] });
    } else if (name === 'pre' || name === 'code') {
      out.push({ t: 'code', text: el.textContent ?? '' });
    } else if (name === 'ac:image' || name === 'img') {
      const file = imageIn(el);
      if (file) out.push({ t: 'image', file });
    } else if (name === 'ac:structured-macro') {
      const macro = el.getAttribute('ac:name');
      if (macro === 'code' || macro === 'noformat') out.push({ t: 'code', text: childNamed(el, 'ac:plain-text-body')?.textContent ?? '' });
      else if (macro !== 'pagetree' && macro !== 'toc') walk(el, out);
    } else if (name === 'br' || name === 'hr' || name === 'script' || name === 'style') {
      continue;
    } else {
      walk(el, out);
    }
  }
}

function childNamed(el: Element, name: string): Element | undefined {
  return Array.from(el.getElementsByTagName('*')).find((c) => tag(c) === name);
}

function imageIn(el: Element): string | undefined {
  const all = [el, ...Array.from(el.getElementsByTagName('*'))];
  for (const c of all) {
    const name = tag(c);
    if (name === 'ri:attachment' && c.getAttribute('ri:filename')) return c.getAttribute('ri:filename')!;
    if (name === 'img') {
      const alias = c.getAttribute('data-linked-resource-default-alias');
      if (alias) return alias;
      const src = c.getAttribute('src') ?? '';
      const file = decodeURIComponent(src.split('?')[0].split('/').pop() ?? '');
      if (file && !src.startsWith('data:')) return file;
    }
  }
  return undefined;
}

function linksIn(el: Element): Link[] {
  return Array.from(el.querySelectorAll('a[href]')).map((a) => ({ text: clean(a.textContent ?? ''), href: a.getAttribute('href')! }));
}

/** Text with <br> and paragraph breaks as newlines; nested lists are skipped (they are read separately). */
function textOf(el: Element, keepSpaces = false): string {
  let s = '';
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) s += node.textContent ?? '';
    else if (node.nodeType === Node.ELEMENT_NODE) {
      const name = tag(node as Element);
      if (name === 'br') s += '\n';
      else if (name === 'ul' || name === 'ol') return;
      else {
        const block = name === 'p' || name === 'div' || /^h[1-6]$/.test(name);
        if (block && s && !s.endsWith('\n')) s += '\n';
        node.childNodes.forEach(visit);
        if (block && !s.endsWith('\n')) s += '\n';
      }
    }
  };
  el.childNodes.forEach(visit);
  if (keepSpaces) return s.replace(/ /g, ' ').replace(/^\n+|\s+$/g, '');
  return clean(s);
}

function listItems(list: Element): OutlineItem[] {
  return Array.from(list.children)
    .filter((li) => tag(li) === 'li')
    .map((li) => {
      const children = Array.from(li.children)
        .filter((c) => tag(c) === 'ul' || tag(c) === 'ol')
        .flatMap(listItems);
      return { text: textOf(li).replace(/\n{2,}/g, '\n').trim(), children };
    })
    .filter((i) => i.text || i.children.length);
}

/** Plain text (e.g. copied from the page without formatting): one block per line, known headings recognised. */
function textToBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const known = Object.values(UC_HEADINGS).map(norm);
  let code: string[] | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/ /g, ' ');
    const trimmed = line.trim();
    if (code) {
      // Mermaid source runs until the "N.3 Rendered Diagram" heading.
      if (/^\d+\.3\s+Rendered Diagram/i.test(trimmed)) {
        blocks.push({ t: 'code', text: code.join('\n').trim() });
        code = null;
      } else {
        if (trimmed) code.push(line.replace(/\s+$/, ''));
        continue;
      }
    }
    if (!trimmed) continue;
    if (/^\d+\.\s+\S/.test(trimmed) && !/^\d+\.\d/.test(trimmed) && /—|Overall/.test(trimmed)) blocks.push({ t: 'h', level: 1, text: trimmed });
    else if (/^\d+\.\d+\s+\S/.test(trimmed) && /Description|Mermaid|Rendered/i.test(trimmed)) {
      blocks.push({ t: 'h', level: 2, text: trimmed });
      if (/Mermaid Diagram Source/i.test(trimmed)) code = [];
    } else if (known.includes(norm(trimmed))) blocks.push({ t: 'h', level: norm(trimmed) === norm(UC_HEADINGS.relatedUseCases) ? 3 : 2, text: trimmed });
    else if (/^Figure \d+:/.test(trimmed)) blocks.push({ t: 'p', text: trimmed, links: [] });
    else blocks.push({ t: 'p', text: trimmed, links: [] });
  }
  if (code?.length) blocks.push({ t: 'code', text: code.join('\n').trim() });
  return blocks;
}

// ---- Page kind ------------------------------------------------------------------------------

export type PageKind = 'usecase' | 'overview' | 'unknown';

export function detectKind(blocks: Block[]): PageKind {
  if (blocks.some((b) => b.t === 'h' && /^\d+\.2\s+Mermaid Diagram Source/i.test(b.text))) return 'overview';
  if (blocks.some((b) => (b.t === 'p' && /Use Case ID\s*:/i.test(b.text)) || (b.t === 'h' && norm(b.text) === norm(UC_HEADINGS.mainScenario)))) return 'usecase';
  return 'unknown';
}

// ---- Use Case page --------------------------------------------------------------------------

type SectionKey = keyof typeof UC_HEADINGS;
const SECTION_BY_NAME = new Map<string, SectionKey>([
  ...Object.entries(UC_HEADINGS).map(([k, v]) => [norm(v), k as SectionKey] as const),
  [norm('Extensions'), 'extensions'],
  [norm('Alternative Flows'), 'extensions'],
  [norm('Main Scenario'), 'mainScenario'],
  [norm('Related Use Case'), 'relatedUseCases'],
]);

function itemsOf(block: Block): OutlineItem[] {
  if (block.t === 'list') return block.items;
  if (block.t === 'p') return [{ text: block.text, children: [] }];
  if (block.t === 'code') return block.text.split('\n').filter(Boolean).map((text) => ({ text, children: [] }));
  return [];
}

export function parseUseCase(blocks: Block[]): { useCase: UseCase; title?: string } {
  const uc = blankUseCase();
  uc.primaryActor = '';
  let pageTitle: string | undefined;
  let section: SectionKey | null = null;
  const parts: Record<Exclude<SectionKey, 'extensions'>, { kind: 'heading' | 'list'; text?: string; items?: OutlineItem[] }[]> = {
    preconditions: [],
    postconditions: [],
    mainScenario: [],
    exceptions: [],
    specialRequirements: [],
    relatedUseCases: [],
  };
  const extParts = new Map<string, OutlineItem[]>();
  let ext: ReturnType<typeof blankExtension> | null = null;
  const related: string[] = [];

  const readHeader = (text: string) => {
    let found = false;
    for (const line of text.split('\n')) {
      const m = /^(Use Case ID|Title|Scope|Primary Actor)\s*:\s*(.*)$/i.exec(line.trim());
      if (!m) continue;
      found = true;
      const key = { 'use case id': 'ucId', title: 'title', scope: 'scope', 'primary actor': 'primaryActor' }[m[1].toLowerCase()] as 'ucId' | 'title' | 'scope' | 'primaryActor';
      uc[key] = m[2].trim();
    }
    return found;
  };

  for (const b of blocks) {
    if (b.t === 'h') {
      const key = SECTION_BY_NAME.get(norm(b.text));
      if (key) {
        section = key;
        ext = null;
        continue;
      }
      if (!section) {
        if (!readHeader(b.text) && b.level === 1) pageTitle = b.text.replace(/^Use Case\s*:\s*/i, '');
        continue;
      }
      if (section === 'extensions') {
        ext = blankExtension(b.text);
        uc.extensions.push(ext);
        extParts.set(ext.id, []);
      } else parts[section].push({ kind: 'heading', text: b.text });
      continue;
    }
    if (!section) {
      if (b.t === 'p') readHeader(b.text);
      continue;
    }
    if (b.t === 'image') continue;
    if (section === 'relatedUseCases') {
      const linkFor = (text: string) => (b.t === 'p' || b.t === 'list' ? b.links.find((l) => text.includes(l.text) && l.text) : undefined);
      for (const item of itemsOf(b)) {
        for (const line of [item.text, ...item.children.map((c) => c.text)]) {
          const link = linkFor(line);
          related.push(link ? `${line} | ${link.href}` : line);
        }
      }
      continue;
    }
    if (section === 'extensions') {
      if (!ext) {
        ext = blankExtension('');
        uc.extensions.push(ext);
        extParts.set(ext.id, []);
      }
      extParts.get(ext.id)!.push(...itemsOf(b));
      continue;
    }
    parts[section].push({ kind: 'list', items: itemsOf(b) });
  }

  const outline = (list: (typeof parts)['preconditions']) =>
    formatOutline(list.map((p) => (p.kind === 'heading' ? { kind: 'heading' as const, text: p.text! } : { kind: 'list' as const, items: p.items! })));
  uc.preconditions = outline(parts.preconditions);
  uc.postconditions = outline(parts.postconditions);
  uc.mainScenario = outline(parts.mainScenario);
  uc.exceptions = outline(parts.exceptions);
  uc.specialRequirements = outline(parts.specialRequirements);
  uc.relatedUseCases = related.join('\n');
  for (const e of uc.extensions) e.body = formatOutline([{ kind: 'list', items: extParts.get(e.id) ?? [] }]);
  return { useCase: uc, title: pageTitle };
}

// ---- Overview page ("Partner Use Cases by Domain") -------------------------------------------

const SECTION_H1 = /^(\d+)\.\s+(.+)$/;

export function parseOverview(blocks: Block[]): DiagramSection[] {
  const sections: DiagramSection[] = [];
  let current: DiagramSection | null = null;
  let part: 'description' | 'mermaid' | 'image' | null = null;
  const description: string[] = [];

  const flush = () => {
    if (current) current.description = description.splice(0).join('\n\n');
  };

  for (const b of blocks) {
    if (b.t === 'h') {
      const top = SECTION_H1.exec(b.text);
      if (b.level === 1 && top && !/^\d+\.\d/.test(b.text)) {
        flush();
        current = { id: newId('sec'), heading: top[2].trim(), description: '', mermaid: '', imageFile: '' };
        sections.push(current);
        part = null;
        continue;
      }
      if (!current) continue;
      if (/^\d+\.\d+\s+Description/i.test(b.text)) part = 'description';
      else if (/^\d+\.\d+\s+Mermaid/i.test(b.text)) part = 'mermaid';
      else if (/^\d+\.\d+\s+Rendered/i.test(b.text)) part = 'image';
      continue;
    }
    if (!current || !part) continue;
    if (part === 'description' && b.t === 'p') description.push(b.text);
    else if (part === 'mermaid' && (b.t === 'code' || b.t === 'p')) current.mermaid = [current.mermaid, normalizeMermaid(b.text)].filter(Boolean).join('\n');
    else if (part === 'image' && b.t === 'image' && !current.imageFile) current.imageFile = b.file;
  }
  flush();
  return sections;
}

/** First line flush left, every following non-empty line indented with four spaces, no blank lines. */
export function normalizeMermaid(text: string): string {
  const lines = text
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.map((l, i) => (i === 0 ? l : `    ${l}`)).join('\n');
}

/** The raw storage before the first numbered section heading (title block, introduction, page tree). */
export function overviewIntro(storage: string): string {
  const re = /<h1[^>]*>([\s\S]*?)<\/h1>/g;
  for (let m = re.exec(storage); m; m = re.exec(storage)) {
    const text = m[1].replace(/<[^>]+>/g, '').trim();
    if (/^\d+\.\s/.test(text)) return storage.slice(0, m.index);
  }
  return storage;
}

export interface ParsedPage {
  kind: Exclude<PageKind, 'unknown'>;
  title?: string;
  useCase?: UseCase;
  sections?: DiagramSection[];
  intro?: string;
}

/** Reads a whole page; throws ImportError when it is neither a Use Case page nor a diagram page. */
export function parsePage(content: string, opts: { storage?: boolean } = {}): ParsedPage {
  if (!content.trim()) throw new ImportError('محتوایی برای ایمپورت وجود ندارد.');
  const blocks = toBlocks(content);
  const kind = detectKind(blocks);
  if (kind === 'usecase') {
    const { useCase, title } = parseUseCase(blocks);
    return { kind, useCase, title };
  }
  if (kind === 'overview') {
    const sections = parseOverview(blocks);
    if (!sections.length) throw new ImportError('بخش نمودار شماره‌داری (مثل «1. Domain — Service») پیدا نشد.');
    return { kind, sections, intro: opts.storage ? overviewIntro(content) : '' };
  }
  throw new ImportError('این صفحه نه ساختار Use Case دارد (Use Case ID و Main Success Scenario) و نه ساختار صفحهٔ نمودارها (N.2 Mermaid Diagram Source).');
}
