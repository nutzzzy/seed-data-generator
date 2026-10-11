import { defaultSettings } from '../lib/defaults';
import { newId, nowIso } from '../lib/ids';
import type { DiagramSection, Extension, OverviewDoc, UcDoc, UcWorkspace, UseCase, UseCaseDoc } from './types';

export function blankUseCase(): UseCase {
  return {
    ucId: '',
    title: '',
    scope: '',
    primaryActor: 'Vendor',
    preconditions: '',
    postconditions: '',
    mainScenario: '',
    extensions: [],
    exceptions: '',
    specialRequirements: '',
    relatedUseCases: '',
  };
}

export function blankExtension(title = ''): Extension {
  return { id: newId('ext'), title, body: '' };
}

export function blankSection(heading = ''): DiagramSection {
  return { id: newId('sec'), heading, description: '', mermaid: 'flowchart TD\n', imageFile: '' };
}

export function newUseCaseDoc(name = 'Use Case جدید', useCase: UseCase = blankUseCase(), flowchart = blankSection()): UseCaseDoc {
  return { kind: 'usecase', id: newId('uc'), name, useCase, flowchart, flowchartNumber: 1, updatedAt: nowIso() };
}

export function newOverviewDoc(name = 'Partner Use Cases by Domain', sections: DiagramSection[] = [blankSection()], intro = ''): OverviewDoc {
  return { kind: 'overview', id: newId('ov'), name, intro, sections, updatedAt: nowIso() };
}

export function defaultUcWorkspace(): UcWorkspace {
  return { version: 1, docs: [], activeId: null, input: '', settings: { ...defaultSettings } };
}

export function docLabel(doc: UcDoc): string {
  if (doc.kind === 'usecase') return doc.useCase.ucId ? `${doc.useCase.ucId} — ${doc.name}` : doc.name;
  return `${doc.name} (${doc.sections.length} نمودار)`;
}

export function figureCaption(number: number, heading: string): string {
  return `Figure ${number}: ${heading.trim()}`;
}

/** 7 + "Coupon — Coupon Service" -> 07_coupon_coupon_service.png (same style as the attachments on the page). */
export function suggestImageFile(number: number, heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return `${String(number).padStart(2, '0')}_${slug || 'diagram'}.png`;
}

/** The image name to use: the one from Confluence, or a suggestion from the number and heading. */
export function imageFileOf(section: DiagramSection, number: number): string {
  return section.imageFile.trim() || suggestImageFile(number, section.heading);
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function touch<T extends UcDoc>(doc: T): T {
  return { ...doc, updatedAt: nowIso() };
}
