import { classifyCvSection, extractCvProfile, plainCvText, type CvSectionKind } from "./split";
import type { CvProfileProps } from "./types";

/**
 * Locate the profile values `extractCvProfile` reads from a CV session in the
 * session's Markdown, so an editor can highlight them and offer to save them
 * to a profile. Ranges are UTF-16 offsets into the Markdown source.
 */

export type CvProfileSection =
   | "identity" | "contacts" | "experiences" | "education" | "projects"
   | "skills" | "certifications" | "languages";

export const CV_PROFILE_SECTIONS: readonly CvProfileSection[] = [
   "identity", "contacts", "experiences", "education", "projects", "skills", "certifications", "languages",
];

export interface CvTextRange { from: number; to: number }

export interface CvDetectedField {
   /** Dotted path into `CvProfileProps`, e.g. `experiences.0.highlights.1`. */
   path: string;
   section: CvProfileSection;
   /** Entry index for list sections. */
   entry?: number;
   /** Leaf field name, e.g. `title`, `value`, `skills`. */
   key: string;
   value: string;
   /** Where the value appears in the source; empty when it could not be located. */
   ranges: CvTextRange[];
   /** 1-based line of the first range. */
   line?: number;
}

export interface CvProfileDetection {
   profile: CvProfileProps;
   fields: CvDetectedField[];
}

interface Span { from: number; to: number; kind: CvSectionKind }
interface Segment extends CvTextRange { plain: string }
interface Leaf { section: CvProfileSection; entry?: number; key: string; path: string; values: string[] }

const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE = /^\s*(?:`{3,}|~{3,})/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?\s*)?\|?\s*$/;
const DIRECTIVE = /^\s*:{3,}/;
const BODY_PREFIX = /^\s*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+)?/;
const ATTRIBUTES = /\s*\{[^{}]+\}\s*$/;
const LINK = /!?\[[^\]]*\]\([^)]*\)|<(?:https?:|mailto:)[^>\s]+>/g;
const WORD = /[\p{L}\p{N}]/u;

const SEARCH_KINDS: Record<CvProfileSection, readonly CvSectionKind[]> = {
   identity: ["header", "summary"],
   contacts: ["header"],
   experiences: ["experience"],
   education: ["education"],
   projects: ["projects"],
   skills: ["skills"],
   certifications: ["certifications"],
   languages: ["languages", "skills"],
};

/** Split the source into `#`/`##` sections, ignoring fenced code. */
function sectionSpans(markdown: string): Span[] {
   const spans: Span[] = [];
   let current: Span = { from: 0, to: markdown.length, kind: "header" };
   let seenName = false;
   let fenced = false;
   let offset = 0;
   for (const line of markdown.split("\n")) {
      if (FENCE.test(line)) fenced = !fenced;
      const heading = fenced ? null : line.match(HEADING);
      if (heading && heading[1]!.length <= 2) {
         const kind: CvSectionKind = heading[1]!.length === 1 && !seenName ? "header" : classifyCvSection(heading[2]!);
         seenName ||= heading[1]!.length === 1;
         current.to = offset;
         spans.push(current);
         current = { from: offset, to: markdown.length, kind };
      }
      offset += line.length + 1;
   }
   spans.push(current);
   return spans.filter(span => span.to > span.from);
}

/** Highlightable pieces of each line: table cells, or the line body without markers. */
function lineSegments(markdown: string, from: number, to: number): Segment[] {
   const segments: Segment[] = [];
   let offset = from;
   for (const line of markdown.slice(from, to).split("\n")) {
      const start = offset;
      offset += line.length + 1;
      if (!line.trim() || DIRECTIVE.test(line) || TABLE_SEPARATOR.test(line)) continue;
      if (TABLE_ROW.test(line)) {
         let cellStart = line.indexOf("|") + 1;
         for (let index = cellStart; index < line.length; index++) {
            if (line[index] !== "|" || line[index - 1] === "\\") continue;
            pushTrimmed(segments, line, start, cellStart, index);
            cellStart = index + 1;
         }
         continue;
      }
      const bodyStart = line.match(BODY_PREFIX)?.[0].length ?? 0;
      const bodyEnd = line.length - (line.match(ATTRIBUTES)?.[0].length ?? 0);
      pushTrimmed(segments, line, start, bodyStart, bodyEnd);
   }
   return segments;
}

function pushTrimmed(segments: Segment[], line: string, lineStart: number, from: number, to: number) {
   const text = line.slice(from, to);
   const lead = text.length - text.trimStart().length;
   const body = text.trim();
   const plain = plainCvText(body);
   if (plain) segments.push({ from: lineStart + from + lead, to: lineStart + from + lead + body.length, plain });
}

/** Grow a match that falls inside a Markdown link or autolink to the whole link. */
function expandToLink(markdown: string, range: CvTextRange): CvTextRange {
   const lineStart = markdown.lastIndexOf("\n", range.from - 1) + 1;
   const lineEnd = markdown.indexOf("\n", range.to);
   const line = markdown.slice(lineStart, lineEnd < 0 ? markdown.length : lineEnd);
   for (const match of line.matchAll(LINK)) {
      const from = lineStart + match.index!;
      const to = from + match[0].length;
      if (from <= range.from && range.to <= to) return { from, to };
   }
   return range;
}

const overlaps = (a: CvTextRange, b: CvTextRange) => a.from < b.to && b.from < a.to;
const isBoundary = (text: string, index: number) => index < 0 || index >= text.length || !WORD.test(text[index]!);

function profileLeaves(profile: CvProfileProps): Leaf[] {
   const leaves: Leaf[] = [];
   const add = (section: CvProfileSection, path: string, key: string, value: string, entry?: number, alternatives: string[] = []) => {
      if (value.trim()) leaves.push({ section, entry, key, path, values: [value, ...alternatives].filter(Boolean) });
   };
   const { identity } = profile;
   add("identity", "identity.fullName", "fullName", identity.fullName);
   add("identity", "identity.headline", "headline", identity.headline);
   add("identity", "identity.location", "location", identity.location);
   add("identity", "identity.summary", "summary", identity.summary);
   profile.contacts.forEach((contact, index) => add("contacts", `contacts.${index}`, contact.kind, contact.value, index, [contact.label]));
   profile.experiences.forEach((item, index) => {
      const base = `experiences.${index}`;
      for (const key of ["company", "title", "location", "start", "end"] as const) add("experiences", `${base}.${key}`, key, item[key], index);
      item.highlights.forEach((text, line) => add("experiences", `${base}.highlights.${line}`, "highlight", text, index));
   });
   profile.education.forEach((item, index) => {
      const base = `education.${index}`;
      for (const key of ["school", "degree", "location", "start", "end", "details"] as const) add("education", `${base}.${key}`, key, item[key], index);
   });
   profile.projects.forEach((item, index) => {
      const base = `projects.${index}`;
      add("projects", `${base}.name`, "name", item.name, index);
      add("projects", `${base}.url`, "url", item.url, index);
      add("projects", `${base}.description`, "description", item.description, index);
      item.technologies.forEach((text, n) => add("projects", `${base}.technologies.${n}`, "technology", text, index));
   });
   profile.skills.forEach((group, index) => {
      if (group.name !== "General") add("skills", `skills.${index}.name`, "name", group.name, index);
      group.skills.forEach((text, n) => add("skills", `skills.${index}.skills.${n}`, "skill", text, index));
   });
   profile.certifications.forEach((item, index) => add("certifications", `certifications.${index}`, "name", item.name, index));
   profile.languages.forEach((text, index) => add("languages", `languages.${index}`, "language", text, index));
   return leaves;
}

const ANCHOR_KEYS: Partial<Record<CvProfileSection, readonly string[]>> = {
   experiences: ["title", "company"],
   education: ["school", "degree"],
   projects: ["name"],
};

/** Start of the table (or line) holding `offset`: an entry's company row precedes its title row. */
function blockStart(markdown: string, offset: number): number {
   let start = markdown.lastIndexOf("\n", offset - 1) + 1;
   while (start > 0) {
      const previous = markdown.lastIndexOf("\n", start - 2) + 1;
      if (!TABLE_ROW.test(markdown.slice(previous, start - 1))) break;
      start = previous;
   }
   return start;
}

/** Extract the profile from a CV session and locate each value in the source. */
export function detectCvProfile(markdown: string): CvProfileDetection {
   const profile = extractCvProfile(markdown);
   const spans = sectionSpans(markdown);
   const leaves = profileLeaves(profile);
   const claimed: CvTextRange[] = [];
   const isFree = (range: CvTextRange) => !claimed.some(taken => overlaps(taken, range));
   const spansFor = (section: CvProfileSection) => spans.filter(span => SEARCH_KINDS[section].includes(span.kind));

   const occurrences = (value: string, from: number, to: number): CvTextRange[] => {
      const found: CvTextRange[] = [];
      for (let index = markdown.indexOf(value, from); index >= 0 && index + value.length <= to; index = markdown.indexOf(value, index + 1)) {
         if (isBoundary(markdown, index - 1) && isBoundary(markdown, index + value.length)) found.push({ from: index, to: index + value.length });
      }
      return found;
   };
   const findRaw = (value: string, from: number, to: number) => {
      const range = occurrences(value, from, to).find(isFree);
      return range && expandToLink(markdown, range);
   };

   const findLines = (value: string, from: number, to: number): CvTextRange[] => {
      const segments = lineSegments(markdown, from, to).filter(isFree);
      const exact = segments.find(segment => segment.plain === value || segment.plain.includes(value));
      if (exact) return [{ from: exact.from, to: exact.to }];
      // A multi-line value (summary, description) spans consecutive lines.
      const start = segments.findIndex(segment => segment.plain.length >= 8 && value.includes(segment.plain));
      if (start < 0) return [];
      const ranges: CvTextRange[] = [];
      for (const segment of segments.slice(start)) {
         if (!value.includes(segment.plain)) break;
         ranges.push({ from: segment.from, to: segment.to });
      }
      return ranges;
   };

   const search = (leaf: Leaf, from: number, to: number): CvTextRange[] => {
      for (const value of leaf.values) {
         const raw = findRaw(value, from, to);
         if (raw) return [raw];
      }
      return findLines(leaf.values[0]!, from, to);
   };
   const searchSpans = (leaf: Leaf, window?: CvTextRange): CvTextRange[] => {
      for (const span of spansFor(leaf.section)) {
         const from = Math.max(span.from, window?.from ?? 0);
         const to = Math.min(span.to, window?.to ?? markdown.length);
         if (from >= to) continue;
         const ranges = search(leaf, from, to);
         if (ranges.length) return ranges;
      }
      return [];
   };

   // Each list entry owns the source from its anchor block to the next entry's.
   const windows = new Map<string, CvTextRange>();
   for (const [section, keys] of Object.entries(ANCHOR_KEYS) as [CvProfileSection, readonly string[]][]) {
      let floor = 0;
      const anchors: { entry: number; from: number }[] = [];
      const entries = new Set(leaves.filter(leaf => leaf.section === section).map(leaf => leaf.entry!));
      for (const entry of entries) {
         const anchor = keys.map(key => leaves.find(leaf => leaf.section === section && leaf.entry === entry && leaf.key === key)).find(Boolean);
         const range = anchor && spansFor(section).map(span => span.to > floor ? occurrences(anchor.values[0]!, Math.max(span.from, floor), span.to)[0] : undefined).find(Boolean);
         if (!range) continue;
         anchors.push({ entry, from: blockStart(markdown, range.from) });
         floor = range.to;
      }
      anchors.forEach((anchor, index) => windows.set(`${section}:${anchor.entry}`, {
         from: anchor.from,
         to: anchors[index + 1]?.from ?? markdown.length,
      }));
   }

   const locate = (leaf: Leaf): CvTextRange[] => {
      const window = leaf.entry === undefined ? undefined : windows.get(`${leaf.section}:${leaf.entry}`);
      if (!window) return searchSpans(leaf);
      const inside = searchSpans(leaf, window);
      if (inside.length) return inside;
      // A value inherited from an enclosing block (a role under its company's table)
      // shares the nearest earlier occurrence.
      for (const value of leaf.values) {
         const before = spansFor(leaf.section).flatMap(span => occurrences(value, span.from, Math.min(span.to, window.from))).at(-1);
         if (before) return [expandToLink(markdown, before)];
      }
      return searchSpans(leaf);
   };

   const fields = leaves.map((leaf): CvDetectedField => {
      const ranges = locate(leaf);
      claimed.push(...ranges);
      const first = ranges[0];
      return {
         path: leaf.path,
         section: leaf.section,
         ...(leaf.entry === undefined ? {} : { entry: leaf.entry }),
         key: leaf.key,
         value: leaf.values[0]!,
         ranges,
         ...(first ? { line: markdown.slice(0, first.from).split("\n").length } : {}),
      };
   });

   return { profile, fields };
}

/**
 * Overwrite the chosen sections of `base` with the detected profile, keeping
 * every other section of `base`. Used to update a saved profile from a session.
 */
export function mergeCvProfileSections(
   base: CvProfileProps,
   detected: CvProfileProps,
   sections: readonly CvProfileSection[],
): CvProfileProps {
   const merged = structuredClone(base);
   const source = structuredClone(detected);
   for (const section of sections) {
      if (section === "identity") merged.identity = source.identity;
      else (merged as any)[section] = (source as any)[section];
   }
   return merged;
}
