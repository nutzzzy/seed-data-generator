import type { Settings } from '../lib/types';

/**
 * Lists are edited as "outline" text: one item per line, two spaces of indentation per nesting level,
 * a line ending with " \" continues the item on the next line (a line break inside the item),
 * and a line starting with "### " is a sub-heading (h3). See outline.ts.
 */
export type Outline = string;

/** One Use Case page, in the structure of the Food Partner Use Case pages in Confluence. */
export interface UseCase {
  ucId: string;
  title: string;
  scope: string;
  primaryActor: string;
  preconditions: Outline;
  postconditions: Outline;
  /** The algorithm: numbered steps of the happy path. */
  mainScenario: Outline;
  extensions: Extension[];
  exceptions: Outline;
  specialRequirements: Outline;
  /** One per line: "UC-ID" or "UC-ID | https://link-to-its-page". */
  relatedUseCases: string;
}

export interface Extension {
  id: string;
  title: string;
  body: Outline;
}

/** One numbered section of the "Partner Use Cases by Domain" page: description, Mermaid source, rendered image. */
export interface DiagramSection {
  id: string;
  /** "<Domain> — <Service or capability>", without the section number. */
  heading: string;
  description: string;
  mermaid: string;
  /** Attachment name of the rendered diagram, e.g. 07_coupon_service.png. */
  imageFile: string;
  /** Mermaid source as it was on Confluence at import/publish; a new image is uploaded only when it changed. */
  publishedMermaid?: string;
}

export interface ConfluenceSource {
  url: string;
  via: 'link' | 'paste';
  pageId?: string;
  title?: string;
  spaceKey?: string;
  /** Page version at import time; publishing refuses to overwrite a newer version. */
  version?: number;
  importedAt: string;
}

interface DocBase {
  id: string;
  name: string;
  source?: ConfluenceSource;
  updatedAt: string;
}

export interface UseCaseDoc extends DocBase {
  kind: 'usecase';
  useCase: UseCase;
  /** The use case drawn as a diagram section, ready to be added to the overview page. */
  flowchart: DiagramSection;
  /** Its section number on the overview page. */
  flowchartNumber: number;
}

export interface OverviewDoc extends DocBase {
  kind: 'overview';
  /** Everything before the first numbered section, kept exactly as imported (Confluence storage format). */
  intro: string;
  sections: DiagramSection[];
}

export type UcDoc = UseCaseDoc | OverviewDoc;

export interface UcWorkspace {
  version: 1;
  docs: UcDoc[];
  activeId: string | null;
  /** Requirements / notes for AI generation. */
  input: string;
  settings: Settings;
}

export type UcIssueLevel = 'error' | 'warning' | 'info';

export interface UcIssue {
  level: UcIssueLevel;
  message: string;
  /** Where the issue is, for display, e.g. "Use Case ID" or "بخش ۳ — Mermaid". */
  where?: string;
}
