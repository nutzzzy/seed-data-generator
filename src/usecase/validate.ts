import { isNotSpecified } from '../lib/model';
import { relatedEntries } from './confluenceExport';
import { lintMermaid } from './mermaid';
import { imageFileOf } from './model';
import { isEmptyOutline, parseOutline } from './outline';
import { DOMAINS, SUPERSEDED_NAMES, UC_HEADINGS, UC_ID_PATTERN } from './rules';
import type { DiagramSection, UcDoc, UcIssue, UseCase } from './types';

const fa = (n: number) => n.toLocaleString('fa-IR');

export function validateUseCase(uc: UseCase, otherIds: string[] = []): UcIssue[] {
  const issues: UcIssue[] = [];
  const err = (where: string, message: string) => issues.push({ level: 'error', where, message });
  const warn = (where: string, message: string) => issues.push({ level: 'warning', where, message });

  if (!uc.ucId.trim()) err('Use Case ID', 'Use Case ID خالی است.');
  else if (!UC_ID_PATTERN.test(uc.ucId.trim())) err('Use Case ID', `«${uc.ucId}» با الگوی UC-… نمی‌خواند (مثل UC-Creates-New-Coupon یا UC-LP-08)؛ فاصله و کاراکتر فارسی مجاز نیست.`);
  else if (otherIds.includes(uc.ucId.trim())) warn('Use Case ID', `Use Case ID «${uc.ucId}» در سند دیگری هم استفاده شده است.`);

  for (const [key, name] of [
    ['title', 'Title'],
    ['scope', 'Scope'],
    ['primaryActor', 'Primary Actor'],
  ] as const) {
    if (!uc[key].trim()) err(name, `${name} خالی است.`);
    else if (isNotSpecified(uc[key])) warn(name, `${name} مشخص نشده (Not specified).`);
  }
  if (uc.title.trim() && /[؀-ۿ]/.test(uc.title)) warn('Title', 'Title در صفحات Confluence انگلیسی است (Actor + فعل + مفعول، مثل Vendor Creates a New Coupon).');

  const required = [
    ['preconditions', UC_HEADINGS.preconditions],
    ['postconditions', UC_HEADINGS.postconditions],
    ['mainScenario', UC_HEADINGS.mainScenario],
  ] as const;
  for (const [key, name] of required) if (isEmptyOutline(uc[key])) err(name, `بخش ${name} خالی است.`);

  const steps = parseOutline(uc.mainScenario).flatMap((b) => (b.kind === 'list' ? b.items : []));
  if (steps.length === 1) warn(UC_HEADINGS.mainScenario, 'Main Success Scenario فقط یک قدم دارد؛ هر کنش Vendor یا پاسخ سیستم یک قدم جداست.');

  if (!uc.extensions.length) warn(UC_HEADINGS.extensions, 'هیچ Alternative Flowای تعریف نشده است.');
  uc.extensions.forEach((e, i) => {
    if (!e.title.trim()) err(UC_HEADINGS.extensions, `Alternative Flow ${fa(i + 1)} عنوان ندارد.`);
    if (isEmptyOutline(e.body)) warn(UC_HEADINGS.extensions, `Alternative Flow «${e.title || fa(i + 1)}» قدمی ندارد.`);
  });
  if (isEmptyOutline(uc.exceptions)) warn(UC_HEADINGS.exceptions, 'بخش Exceptions خالی است.');
  if (isEmptyOutline(uc.specialRequirements)) issues.push({ level: 'info', where: UC_HEADINGS.specialRequirements, message: 'بخش Special Requirements خالی است.' });

  for (const r of relatedEntries(uc.relatedUseCases)) {
    if (!UC_ID_PATTERN.test(r.id)) warn(UC_HEADINGS.relatedUseCases, `«${r.id}» شناسهٔ Use Case نیست؛ فقط UC ID بنویسید (مثل UC-Coupon-03).`);
  }

  const all = [uc.title, uc.scope, uc.preconditions, uc.postconditions, uc.mainScenario, uc.exceptions, uc.specialRequirements, ...uc.extensions.flatMap((e) => [e.title, e.body])].join('\n');
  if (/\bNot specified\b/i.test(all)) warn('محتوا', 'بعضی موارد Not specified هستند؛ قبل از انتشار تکمیل شوند.');
  checkNames(all, issues);
  return issues;
}

function checkNames(text: string, issues: UcIssue[]) {
  for (const [old, current] of Object.entries(SUPERSEDED_NAMES)) {
    if (text.includes(old)) issues.push({ level: 'warning', where: 'نام Domain', message: `«${old}» نام قدیمی است؛ از «${current}» استفاده کنید.` });
  }
}

export function validateSection(section: DiagramSection, number: number): UcIssue[] {
  const where = `بخش ${fa(number)}`;
  const issues: UcIssue[] = [];
  const heading = section.heading.trim();
  if (!heading) issues.push({ level: 'error', where, message: 'عنوان بخش خالی است («Domain — Service»).' });
  else if (!heading.includes(' — ') && !/Overall/i.test(heading)) {
    issues.push({ level: 'warning', where, message: `عنوان «${heading}» باید به شکل «Domain — Service» با خط تیرهٔ بلند (—) باشد.` });
  } else if (!/Overall/i.test(heading)) {
    const domain = heading.split(' — ')[0].trim();
    if (!DOMAINS.some((d) => domain.startsWith(d))) {
      issues.push({ level: 'info', where, message: `«${domain}» جزو Domainهای فعلی نیست (${DOMAINS.join('، ')}).` });
    }
  }
  if (!section.description.trim()) issues.push({ level: 'error', where: `${where} · Description`, message: 'Description خالی است.' });
  // In the overall dependency diagram the nodes are the domains themselves, not references to them.
  const overall = /Overall Service Dependency/i.test(heading);
  for (const i of lintMermaid(section.mermaid)) {
    if (overall && i.level === 'info') continue;
    issues.push({ ...i, where: `${where} · ${i.where ?? 'Mermaid'}` });
  }
  if (!/\.(png|jpe?g|svg)$/i.test(imageFileOf(section, number))) {
    issues.push({ level: 'warning', where: `${where} · Rendered Diagram`, message: 'نام فایل تصویر باید .png باشد.' });
  }
  checkNames([section.heading, section.description, section.mermaid].join('\n'), issues);
  return issues;
}

export function validateDoc(doc: UcDoc, allDocs: UcDoc[] = []): UcIssue[] {
  if (doc.kind === 'usecase') {
    const others = allDocs.filter((d) => d.id !== doc.id && d.kind === 'usecase').map((d) => (d.kind === 'usecase' ? d.useCase.ucId.trim() : ''));
    const flowchart = doc.flowchart.mermaid.trim() && doc.flowchart.mermaid.trim() !== 'flowchart TD' ? validateSection(doc.flowchart, doc.flowchartNumber) : [];
    return [...validateUseCase(doc.useCase, others), ...flowchart.map((i) => ({ ...i, where: `فلوچارت · ${i.where}` }))];
  }
  const issues = doc.sections.flatMap((s, i) => validateSection(s, i + 1));
  if (!doc.sections.length) issues.push({ level: 'error', message: 'صفحه هیچ بخش نموداری ندارد.' });
  return issues;
}
