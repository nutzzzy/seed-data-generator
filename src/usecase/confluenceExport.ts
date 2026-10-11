import { figureCaption, imageFileOf } from './model';
import { parseOutline, type OutlineBlock, type OutlineItem } from './outline';
import { UC_HEADINGS, UC_LABELS } from './rules';
import type { DiagramSection, OverviewDoc, UseCase } from './types';

/**
 * Exports in the structure of the Confluence pages:
 *  - "storage": Confluence storage format, the same markup the pages use (bidi classes, ac:image attachments);
 *    used when publishing through the REST API.
 *  - "paste": plain HTML for pasting into the Confluence editor.
 * plus wiki markup (Insert → Markup) and Markdown.
 */
export type Flavor = 'storage' | 'paste';

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lines = (s: string) => esc(s).split('\n').join('<br />');

const RTL = { storage: ' class="bidi-direction-rtl" style="text-align: right;"', paste: ' dir="rtl" style="text-align: right;"' } as const;
const LTR = { storage: ' class="bidi-direction-ltr"', paste: ' dir="ltr"' } as const;

// ---- Use Case page -----------------------------------------------------------------------

function listHtml(items: OutlineItem[], ordered: boolean, f: Flavor): string {
  const tagName = ordered ? 'ol' : 'ul';
  const li = (i: OutlineItem) => `<li><p>${lines(i.text)}</p>${i.children.length ? listHtml(i.children, false, f) : ''}</li>`;
  return `<${tagName}${RTL[f]}>${items.map(li).join('')}</${tagName}>`;
}

function outlineHtml(text: string, ordered: boolean, f: Flavor): string {
  return parseOutline(text)
    .map((b) => (b.kind === 'heading' ? `<h3${RTL[f]}>${esc(b.text)}</h3>` : listHtml(b.items, ordered, f)))
    .join('');
}

export function relatedEntries(text: string): { id: string; href?: string }[] {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^[-*•]\s+/, ''))
    .filter(Boolean)
    .map((l) => {
      const [id, href] = l.split('|').map((s) => s.trim());
      return { id, href: href || undefined };
    });
}

export function useCaseHtml(uc: UseCase, f: Flavor = 'storage'): string {
  const label = (name: string, value: string) => `<strong>${esc(name)}:</strong> ${esc(value)}`;
  const h2 = (text: string) => `<h2${RTL[f]}>${esc(text)}</h2>`;
  const out = [
    `<p${RTL[f]}>${label(UC_LABELS.ucId, uc.ucId)}</p>`,
    `<p${RTL[f]}>${[label(UC_LABELS.title, uc.title), label(UC_LABELS.scope, uc.scope), label(UC_LABELS.primaryActor, uc.primaryActor)].join('<br />')}</p>`,
    h2(UC_HEADINGS.preconditions),
    outlineHtml(uc.preconditions, false, f),
    h2(UC_HEADINGS.postconditions),
    outlineHtml(uc.postconditions, false, f),
    h2(UC_HEADINGS.mainScenario),
    outlineHtml(uc.mainScenario, true, f),
    h2(UC_HEADINGS.extensions),
    ...uc.extensions.map((e) => `<h3${RTL[f]}>${esc(e.title)}</h3>${outlineHtml(e.body, false, f)}`),
    h2(UC_HEADINGS.exceptions),
    outlineHtml(uc.exceptions, false, f),
    h2(UC_HEADINGS.specialRequirements),
    outlineHtml(uc.specialRequirements, false, f),
  ];
  const related = relatedEntries(uc.relatedUseCases);
  out.push(`<h3${RTL[f]}><strong>${esc(UC_HEADINGS.relatedUseCases)}</strong></h3>`);
  if (related.length) {
    out.push(`<ul${RTL[f]}>${related.map((r) => `<li><p>${r.href ? `<a href="${esc(r.href)}">${esc(r.id)}</a>` : esc(r.id)}</p></li>`).join('')}</ul>`);
  }
  return out.join('');
}

// ---- Diagram sections ------------------------------------------------------------------------

function mermaidTable(mermaid: string, f: Flavor): string {
  const code = esc(mermaid.replace(/\s+$/, '')).split('\n').join('<br />');
  if (f === 'paste') return `<table dir="ltr" style="direction: ltr;text-align: left;"><tbody><tr><td style="text-align: left;"><p dir="ltr">${code}</p></td></tr></tbody></table>`;
  return `<div class="bidi-direction-ltr table-wrapper"><table class="bidi-direction-ltr my-bidi-table wrapped" style="direction: ltr;text-align: left;"><tbody><tr><td style="text-align: left;"><p class="bidi-direction-ltr">${code}</p></td></tr></tbody></table></div>`;
}

export interface SectionExportOptions {
  /** For "paste": an image (data URL) to show in place of the attachment. */
  imageDataUrl?: string;
}

export function sectionHtml(section: DiagramSection, number: number, f: Flavor = 'storage', opts: SectionExportOptions = {}): string {
  const file = imageFileOf(section, number);
  const caption = figureCaption(number, section.heading);
  const image =
    f === 'storage'
      ? `<ac:image ac:height="250"><ri:attachment ri:filename="${esc(file)}" /></ac:image>`
      : opts.imageDataUrl
        ? `<img src="${opts.imageDataUrl}" alt="${esc(file)}" height="250" />`
        : `[${esc(file)}]`;
  return [
    `<h1>${number}. ${esc(section.heading)}</h1>`,
    `<h2>${number}.1 Description</h2>`,
    ...section.description
      .split(/\n{2,}/)
      .filter((p) => p.trim())
      .map((p) => `<p>${lines(p.trim())}</p>`),
    `<h2>${number}.2 Mermaid Diagram Source</h2>`,
    mermaidTable(section.mermaid, f),
    `<h2>${number}.3 Rendered Diagram</h2>`,
    `<p${LTR[f]} style="text-align: center;">${image}</p>`,
    `<p${LTR[f]} style="text-align: center;"><em>${esc(caption)}</em></p>`,
  ].join('');
}

/** The whole overview page: the imported intro kept as it was, then every section renumbered 1..n. */
export function overviewHtml(doc: OverviewDoc, f: Flavor = 'storage'): string {
  const intro = f === 'storage' ? doc.intro : '';
  return intro + doc.sections.map((s, i) => sectionHtml(s, i + 1, f)).join('');
}

// ---- Wiki markup -----------------------------------------------------------------------------

const wikiEsc = (s: string) => s.replace(/([{}[\]|*_\-+^~!])/g, '\\$1');

function wikiOutline(text: string, ordered: boolean): string {
  const out: string[] = [];
  const write = (items: OutlineItem[], prefix: string) => {
    for (const i of items) {
      out.push(`${prefix} ${i.text.split('\n').map(wikiEsc).join(' \\\\ ')}`);
      write(i.children, `${prefix}*`);
    }
  };
  for (const b of parseOutline(text) as OutlineBlock[]) {
    if (b.kind === 'heading') out.push(`h3. ${b.text}`);
    else write(b.items, ordered ? '#' : '*');
  }
  return out.join('\n');
}

export function useCaseWiki(uc: UseCase): string {
  const related = relatedEntries(uc.relatedUseCases);
  return [
    `*${UC_LABELS.ucId}:* ${uc.ucId}`,
    '',
    `*${UC_LABELS.title}:* ${uc.title} \\\\ *${UC_LABELS.scope}:* ${uc.scope} \\\\ *${UC_LABELS.primaryActor}:* ${uc.primaryActor}`,
    `h2. ${UC_HEADINGS.preconditions}`,
    wikiOutline(uc.preconditions, false),
    `h2. ${UC_HEADINGS.postconditions}`,
    wikiOutline(uc.postconditions, false),
    `h2. ${UC_HEADINGS.mainScenario}`,
    wikiOutline(uc.mainScenario, true),
    `h2. ${UC_HEADINGS.extensions}`,
    ...uc.extensions.flatMap((e) => [`h3. ${e.title}`, wikiOutline(e.body, false)]),
    `h2. ${UC_HEADINGS.exceptions}`,
    wikiOutline(uc.exceptions, false),
    `h2. ${UC_HEADINGS.specialRequirements}`,
    wikiOutline(uc.specialRequirements, false),
    `h3. *${UC_HEADINGS.relatedUseCases}*`,
    ...related.map((r) => (r.href ? `* [${r.id}|${r.href}]` : `* ${r.id}`)),
  ]
    .filter((l, i, all) => l !== '' || all[i - 1] !== '')
    .join('\n');
}

export function sectionWiki(section: DiagramSection, number: number): string {
  return [
    `h1. ${number}. ${section.heading}`,
    `h2. ${number}.1 Description`,
    section.description.trim(),
    `h2. ${number}.2 Mermaid Diagram Source`,
    '{noformat}',
    section.mermaid.replace(/\s+$/, ''),
    '{noformat}',
    `h2. ${number}.3 Rendered Diagram`,
    `!${imageFileOf(section, number)}|height=250,align=center!`,
    `_${figureCaption(number, section.heading)}_`,
  ].join('\n');
}

// ---- Markdown ----------------------------------------------------------------------------------

function mdOutline(text: string, ordered: boolean): string {
  const out: string[] = [];
  const write = (items: OutlineItem[], depth: number, numbered: boolean) => {
    items.forEach((i, n) => {
      out.push(`${'   '.repeat(depth)}${numbered ? `${n + 1}.` : '-'} ${i.text.split('\n').join('  \n' + '   '.repeat(depth + 1))}`);
      write(i.children, depth + 1, false);
    });
  };
  for (const b of parseOutline(text)) {
    if (b.kind === 'heading') out.push(`### ${b.text}`);
    else write(b.items, 0, ordered);
  }
  return out.join('\n');
}

export function useCaseMarkdown(uc: UseCase): string {
  const related = relatedEntries(uc.relatedUseCases);
  return [
    `**${UC_LABELS.ucId}:** ${uc.ucId}`,
    '',
    `**${UC_LABELS.title}:** ${uc.title}  \n**${UC_LABELS.scope}:** ${uc.scope}  \n**${UC_LABELS.primaryActor}:** ${uc.primaryActor}`,
    '',
    `## ${UC_HEADINGS.preconditions}`,
    mdOutline(uc.preconditions, false),
    '',
    `## ${UC_HEADINGS.postconditions}`,
    mdOutline(uc.postconditions, false),
    '',
    `## ${UC_HEADINGS.mainScenario}`,
    mdOutline(uc.mainScenario, true),
    '',
    `## ${UC_HEADINGS.extensions}`,
    ...uc.extensions.flatMap((e) => [`### ${e.title}`, mdOutline(e.body, false), '']),
    `## ${UC_HEADINGS.exceptions}`,
    mdOutline(uc.exceptions, false),
    '',
    `## ${UC_HEADINGS.specialRequirements}`,
    mdOutline(uc.specialRequirements, false),
    '',
    `### **${UC_HEADINGS.relatedUseCases}**`,
    ...related.map((r) => (r.href ? `- [${r.id}](${r.href})` : `- ${r.id}`)),
  ].join('\n');
}

export function sectionMarkdown(section: DiagramSection, number: number): string {
  return [
    `# ${number}. ${section.heading}`,
    `## ${number}.1 Description`,
    section.description.trim(),
    `## ${number}.2 Mermaid Diagram Source`,
    '```mermaid',
    section.mermaid.replace(/\s+$/, ''),
    '```',
    `## ${number}.3 Rendered Diagram`,
    `![${figureCaption(number, section.heading)}](${imageFileOf(section, number)})`,
    `*${figureCaption(number, section.heading)}*`,
  ].join('\n\n');
}

/** Plain text used as the text/plain part of rich copies. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/<br \/>/g, '\n').replace(/<\/(p|h\d|li|tr)>/g, '$&\n'), 'text/html');
  return (doc.body.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}
