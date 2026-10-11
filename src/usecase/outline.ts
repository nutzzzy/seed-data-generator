import type { Outline } from './types';

export interface OutlineItem {
  /** May contain "\n" for line breaks inside the item. */
  text: string;
  children: OutlineItem[];
}

export type OutlineBlock = { kind: 'heading'; text: string } | { kind: 'list'; items: OutlineItem[] };

const MARKER = /^(?:[-*•]|\d+[.)])\s+/;

/** Parses outline text (see types.ts) into headings and nested lists. */
export function parseOutline(text: Outline): OutlineBlock[] {
  const blocks: OutlineBlock[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let list: Extract<OutlineBlock, { kind: 'list' }> | null = null;
  // stack[d] = the last item at depth d
  let stack: OutlineItem[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/\t/g, '  ');
    // Line continuations: "text \" + next line.
    while (/\s\\$/.test(line) && i + 1 < lines.length) {
      line = `${line.replace(/\s*\\$/, '')}\n${lines[++i].trim()}`;
    }
    if (!line.trim()) continue;
    const heading = /^\s*###\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', text: heading[1].trim() });
      list = null;
      stack = [];
      continue;
    }
    const indent = /^ */.exec(line)![0].length;
    const depth = Math.min(Math.floor(indent / 2), stack.length);
    const item: OutlineItem = { text: line.trim().replace(MARKER, '').trim(), children: [] };
    if (!list) {
      list = { kind: 'list', items: [] };
      blocks.push(list);
    }
    if (depth === 0) list.items.push(item);
    else stack[depth - 1].children.push(item);
    stack = [...stack.slice(0, depth), item];
  }
  return blocks;
}

/** Writes items back as outline text. */
export function formatOutline(blocks: OutlineBlock[]): Outline {
  const out: string[] = [];
  const write = (items: OutlineItem[], depth: number) => {
    for (const item of items) {
      const parts = item.text.split('\n').map((p) => p.trim()).filter(Boolean);
      // An item without text that only wraps a nested list keeps its children at its own level.
      if (!parts.length) {
        write(item.children, depth);
        continue;
      }
      out.push('  '.repeat(depth) + parts.join(' \\\n' + '  '.repeat(depth)));
      write(item.children, depth + 1);
    }
  };
  for (const b of blocks) {
    if (b.kind === 'heading') out.push(`### ${b.text}`);
    else write(b.items, 0);
  }
  return out.join('\n');
}

/** Top-level item texts (headings skipped), e.g. the main scenario steps. */
export function topItems(text: Outline): string[] {
  return parseOutline(text).flatMap((b) => (b.kind === 'list' ? b.items.map((i) => i.text) : []));
}

export function isEmptyOutline(text: Outline): boolean {
  return parseOutline(text).length === 0;
}
