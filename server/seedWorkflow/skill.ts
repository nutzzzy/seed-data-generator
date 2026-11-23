import { existsSync, readFileSync } from 'node:fs';
import { ConfluenceError } from '../confluence/api.ts';

/** Reads the Skill file (without its YAML front matter); the single source of the generation rules. */
export function loadSkill(path: string): string {
  if (!existsSync(path)) throw new ConfluenceError(500, `فایل Skill پیدا نشد: ${path}`);
  return readFileSync(path, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

/**
 * Confluence page IDs listed under "## Reference pages" in the Skill: the guide and its examples. They are read as
 * documentation but are never treated as existing Seed Data (duplicate detection) and never updated.
 */
export function referencePageIds(skill: string): Set<string> {
  const section = /^## Reference pages?\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(skill)?.[1] ?? '';
  const ids = new Set<string>();
  for (const line of section.split('\n')) {
    if (!/^\s*[-*]\s/.test(line)) continue;
    for (const m of line.matchAll(/\/pages\/(\d+)|pageId=(\d+)|page ID (\d+)/gi)) ids.add(m[1] ?? m[2] ?? m[3]);
  }
  return ids;
}

/** The "## Domain codes" table of the Skill: code -> name of the Domain page under QA Seed Data. */
export function domainCodes(skill: string): Record<string, string> {
  const section = /^## Domain codes\s*$([\s\S]*?)(?=^## |(?![\s\S]))/im.exec(skill)?.[1] ?? '';
  const out: Record<string, string> = {};
  for (const line of section.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 4) continue;
    const [, code, name] = cells;
    if (/^[A-Z0-9]+$/.test(code) && name && !/^-+$/.test(name)) out[code] = name.replace(/\s*\(.*\)\s*$/, '').trim();
  }
  return out;
}
