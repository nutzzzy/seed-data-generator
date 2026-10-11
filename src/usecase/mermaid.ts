import { parseOutline, topItems } from './outline';
import type { UcIssue, UseCase } from './types';

/**
 * Rule checks for the Mermaid source of a diagram section, following the conventions of
 * "Partner Use Cases by Domain" (see rules.ts → DIAGRAM_RULES). Syntax errors are found separately by
 * Mermaid itself in the live preview.
 */

const SHAPES: [open: string, close: string][] = [
  ['[[', ']]'],
  ['[(', ')]'],
  ['((', '))'],
  ['([', '])'],
  ['{{', '}}'],
  ['[', ']'],
  ['{', '}'],
  ['(', ')'],
  ['>', ']'],
];

export interface MermaidNode {
  id: string;
  label: string;
  quoted: boolean;
  shape: string;
  line: number;
}

/** Finds node definitions like Id["Label"], Id{"Label"}, Id[["Label"]] (also unquoted ones). */
export function findNodes(source: string): MermaidNode[] {
  const nodes: MermaidNode[] = [];
  source.split('\n').forEach((raw, index) => {
    const line = raw.replace(/%%.*$/, '');
    // Remove edge labels so their text is not taken for nodes.
    const body = line.replace(/\|[^|]*\|/g, ' ').replace(/--\s*"[^"]*"\s*-->/g, '-->');
    const re = /(?:^|[\s;&>-])([A-Za-z_][\w-]*)\s*(\[\[|\[\(|\(\(|\(\[|\{\{|\[|\{|\(|>)/g;
    for (let m = re.exec(body); m; m = re.exec(body)) {
      const [open, close] = SHAPES.find(([o]) => o === m![2])!;
      const start = m.index + m[0].length;
      const rest = body.slice(start);
      let label: string;
      let quoted = false;
      let end: number;
      if (rest.trimStart().startsWith('"')) {
        const q = rest.indexOf('"');
        const q2 = rest.indexOf('"', q + 1);
        label = q2 > q ? rest.slice(q + 1, q2) : rest.slice(q + 1);
        quoted = true;
        end = q2 > q ? rest.indexOf(close, q2) : rest.length;
      } else {
        end = rest.indexOf(close);
        label = (end >= 0 ? rest.slice(0, end) : rest).trim();
      }
      nodes.push({ id: m[1], label, quoted, shape: open + close, line: index + 1 });
      re.lastIndex = start + Math.max(end, 0) + close.length;
    }
  });
  return nodes;
}

const KEYWORDS = new Set(['flowchart', 'graph', 'subgraph', 'end', 'direction', 'classDef', 'class', 'style', 'linkStyle', 'click']);

export function lintMermaid(source: string): UcIssue[] {
  const issues: UcIssue[] = [];
  const lines = source.split('\n');
  const first = lines.find((l) => l.trim() && !l.trim().startsWith('%%'))?.trim() ?? '';
  const where = 'Mermaid';
  if (!first) return [{ level: 'error', where, message: 'کد Mermaid خالی است.' }];
  if (!/^flowchart\s+(TD|LR)$/.test(first)) {
    issues.push({
      level: /^(flowchart|graph)\s+(TB|TD|LR|RL|BT)$/.test(first) ? 'warning' : 'error',
      where,
      message: `خط اول باید «flowchart TD» یا «flowchart LR» باشد (الان: «${first}»).`,
    });
  }
  const body = lines.filter((l) => l.trim() && l.trim() !== first);
  if (!body.length) issues.push({ level: 'error', where, message: 'نمودار هیچ گره یا یالی ندارد.' });

  const nodes = findNodes(source).filter((n) => !KEYWORDS.has(n.id));
  const labels = new Map<string, string>();
  for (const n of nodes) {
    if (!n.quoted) {
      const special = /[&/():]/.test(n.label);
      issues.push({
        level: special ? 'error' : 'warning',
        where: `${where} · خط ${n.line}`,
        message: `برچسب گره ${n.id} داخل "" نیست: ${n.id}${n.shape.slice(0, n.shape.length / 2)}"${n.label}"${n.shape.slice(n.shape.length / 2)}${special ? ' (کاراکترهای & / ( ) : بدون "" نمودار را خراب می‌کنند)' : ''}.`,
      });
    }
    const before = labels.get(n.id);
    if (before !== undefined && before !== n.label) {
      issues.push({ level: 'warning', where: `${where} · خط ${n.line}`, message: `گره ${n.id} دو برچسب متفاوت دارد: «${before}» و «${n.label}».` });
    }
    labels.set(n.id, n.label);
    if (/\bDomain\b/.test(n.label) && n.shape !== '[[]]' && n.shape !== '{}') {
      issues.push({ level: 'info', where: `${where} · خط ${n.line}`, message: `«${n.label}» به Domain دیگری ارجاع می‌دهد؛ طبق قاعده با [[" "]] رسم شود.` });
    }
  }

  lines.forEach((raw, i) => {
    const line = raw.replace(/%%.*$/, '');
    const at = `${where} · خط ${i + 1}`;
    for (const m of line.matchAll(/(?:--|-\.|==)\s*([^\s"|>-][^>|]*?)\s*(?:-->|\.->|==>)/g)) {
      issues.push({ level: 'warning', where: at, message: `برچسب یال «${m[1]}» داخل "" نیست؛ بنویسید -- "${m[1]}" -->.` });
    }
    for (const m of line.matchAll(/(?:-->|-\.->|==>)\|([^|]*)\|/g)) {
      if (!/^\s*".*"\s*$/.test(m[1])) issues.push({ level: 'warning', where: at, message: `برچسب یال «${m[1]}» داخل "" نیست؛ بنویسید -->|"${m[1].trim()}"|.` });
    }
    if (/[^\x00-\x7F]/.test(line.replace(/"[^"]*"/g, ''))) {
      issues.push({ level: 'error', where: at, message: 'شناسهٔ گره فقط حروف انگلیسی، عدد و _ دارد؛ متن فارسی فقط داخل برچسب "…" مجاز است.' });
    }
  });
  return issues;
}

// ---- Algorithm (Use Case) → flowchart ----------------------------------------------------------

const label = (s: string, max = 70) => {
  const one = s.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
  return one.length > max ? `${one.slice(0, max - 1).trim()}…` : one;
};

/**
 * A first draft of the flowchart from the use case's algorithm, without AI: entry point, the main scenario
 * steps in order, alternative flows and exceptions as labelled branches, and the end state.
 * Labels keep the use case's own wording; refine them (and where each branch starts) in the editor.
 */
export function flowchartFromUseCase(uc: UseCase): string {
  const out: string[] = ['flowchart TD'];
  const add = (l: string) => out.push(`    ${l}`);
  const steps = topItems(uc.mainScenario);
  add(`Start[["${label(`${uc.scope || 'Entry'}: ${uc.title || uc.ucId || 'Use Case'}`)}"]]`);
  let prev = 'Start';
  steps.forEach((s, i) => {
    const id = `Step${i + 1}`;
    add(`${prev} --> ${id}["${label(s)}"]`);
    prev = id;
  });
  const done = label(topItems(uc.postconditions)[0] ?? 'Use Case Completed');
  add(`${prev} --> Done[["${done}"]]`);

  const flows = uc.extensions.filter((e) => e.title.trim() || parseOutline(e.body).length);
  if (flows.length) {
    add(`Start --> AltCheck{"Alternative Flow?"}`);
    flows.forEach((e, i) => {
      const first = topItems(e.body)[0];
      const id = `Alt${i + 1}`;
      add(`AltCheck -- "${label(e.title || `Flow ${i + 1}`, 50)}" --> ${id}["${label(first ?? e.title)}"]`);
    });
  }
  const exceptions = topItems(uc.exceptions);
  if (exceptions.length) {
    add(`${steps.length ? 'Step1' : 'Start'} -.-> ExcCheck{"Exception?"}`);
    exceptions.forEach((x, i) => add(`ExcCheck -- "${i + 1}" --> Exc${i + 1}[["${label(x)}"]]`));
  }
  return out.join('\n');
}
