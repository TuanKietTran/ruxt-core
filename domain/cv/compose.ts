import { classifyCvContact, classifyCvSection, plainCvText, type CvSectionKind } from "./split";
import type { CvContact, CvProfileProps } from "./types";

/**
 * Compose a profile into a template skeleton or a session-derived skeleton.
 * This is the inverse of `splitCvApplication`: the skeleton decides structure
 * and entry shape, the profile supplies every personal value.
 */

type ContentKind = Exclude<CvSectionKind, "header" | "other">;

interface Block { content: string[]; suffix: string[] }
interface SkeletonSection { heading: string; kind: CvSectionKind; body: string[]; suffix: string[] }
interface ParsedSkeleton { prefix: string[]; header: string[]; headerSuffix: string[]; sections: SkeletonSection[] }

interface SectionShape {
   layout: "table" | "heading" | "flat";
   separator: string;
   strong: string;
   hashes: string;
   meta: string;
   bullet: string;
   hasBullets: boolean;
   itemLines: boolean;
}

const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const LIST_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?\s*)?\|?\s*$/;
const DIRECTIVE = /^\s*:{3,}/;
const THEMATIC_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*(?:`{3,}|~{3,})/;
const ATTRIBUTES = /\s*\{[^{}]+\}\s*$/;
const WRAPPED = /^(\*\*|__|\*|_)(\S(?:.*\S)?)\1$/;
const TOKEN_SEPARATOR = /\s+[·•|]\s+/;
const MUSTACHE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;
const HAS_MUSTACHE = /\{\{\s*[a-zA-Z]+\s*\}\}/;

const CONTENT_ORDER: readonly ContentKind[] = [
   "summary", "experience", "education", "projects", "skills", "certifications", "languages",
];
const DEFAULT_TITLES: Record<ContentKind, string> = {
   summary: "Summary",
   experience: "Experience",
   education: "Education",
   projects: "Projects",
   skills: "Skills",
   certifications: "Certifications",
   languages: "Languages",
};
const DEFAULT_SHAPE: SectionShape = {
   layout: "heading", separator: "| :-- | --: |", strong: "**", hashes: "###", meta: "*",
   bullet: "- ", hasBullets: true, itemLines: false,
};

const isStructural = (line: string) => !line.trim() || DIRECTIVE.test(line) || THEMATIC_BREAK.test(line);
const attributesOf = (text: string) => {
   const match = text.match(ATTRIBUTES);
   return match ? ` ${match[0].trim()}` : "";
};
const cell = (text: string) => text.replace(/\|/g, "\\|");
const wrap = (text: string, marker: string) => (text ? `${marker}${text}${marker}` : "");
const joinDates = (start: string, end: string) => (start && end ? `${start} – ${end}` : start || end);
const href = (url: string) => (/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`);
const displayUrl = (url: string) => url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
const link = (url: string, label = "") => (url ? `[${label || displayUrl(url)}](${href(url)})` : label);
const paragraphs = (text: string) => text.split(/\n\s*\n/).map(part => part.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);

function formatContact(contact: CvContact): string {
   const value = contact.value.trim();
   const label = contact.label.trim();
   if (!value) return label;
   switch (contact.kind) {
      case "email": return `[${label || value}](mailto:${value.replace(/^mailto:/i, "")})`;
      case "phone": return label || value;
      case "linkedin":
      case "github":
      case "website": return link(value, label);
      default: return label || value;
   }
}

function contactLine(profile: CvProfileProps): string {
   return [profile.identity.location.trim(), ...profile.contacts.map(formatContact)].filter(Boolean).join(" · ");
}

function hasContent(profile: CvProfileProps, kind: ContentKind): boolean {
   switch (kind) {
      case "summary": return Boolean(profile.identity.summary.trim());
      case "experience": return profile.experiences.length > 0;
      case "education": return profile.education.length > 0;
      case "projects": return profile.projects.length > 0;
      case "skills": return profile.skills.some(group => group.skills.length > 0);
      case "certifications": return profile.certifications.some(item => item.name.trim());
      case "languages": return profile.languages.some(item => item.trim());
   }
}

function trimTrailingStructural(lines: string[]): { content: string[]; suffix: string[] } {
   let end = lines.length;
   while (end > 0 && isStructural(lines[end - 1]!)) end--;
   return { content: lines.slice(0, end), suffix: lines.slice(end) };
}

function parseSkeleton(skeleton: string): ParsedSkeleton {
   const parsed: ParsedSkeleton = { prefix: [], header: [], headerSuffix: [], sections: [] };
   let target = parsed.prefix;
   let seenName = false;
   let fenced = false;

   for (const line of skeleton.split(/\r?\n/)) {
      if (FENCE.test(line)) fenced = !fenced;
      const heading = fenced ? null : line.match(HEADING);
      if (heading && heading[1]!.length === 1 && !seenName) {
         seenName = true;
         target = parsed.header;
      } else if (heading && heading[1]!.length <= 2) {
         const section: SkeletonSection = { heading: line, kind: classifyCvSection(heading[2]!), body: [], suffix: [] };
         parsed.sections.push(section);
         target = section.body;
         continue;
      }
      target.push(line);
   }

   const header = trimTrailingStructural(parsed.header);
   parsed.header = header.content;
   parsed.headerSuffix = header.suffix;
   for (const section of parsed.sections) {
      const { content, suffix } = trimTrailingStructural(section.body);
      section.body = content;
      section.suffix = suffix;
   }
   return parsed;
}

function detectShape(body: string[]): SectionShape {
   const shape: SectionShape = { ...DEFAULT_SHAPE, layout: "flat", hasBullets: false };
   const row = body.find(line => TABLE_ROW.test(line) && !TABLE_SEPARATOR.test(line));
   const heading = body.map(line => line.match(HEADING)).find(match => match && match[1]!.length >= 3);
   if (row) {
      shape.layout = "table";
      shape.separator = body.find(line => TABLE_SEPARATOR.test(line))?.trim() ?? DEFAULT_SHAPE.separator;
      const first = row.trim().replace(/^\|/, "").split(/(?<!\\)\|/)[0]!.trim();
      shape.strong = first.match(WRAPPED)?.[1] ?? "";
   } else if (heading) {
      shape.layout = "heading";
      shape.hashes = heading[1]!;
   }
   const meta = body.map(line => line.trim().replace(ATTRIBUTES, "")).find(line => /^(\*|_)[^*_].*\1$/.test(line));
   if (meta) shape.meta = meta[0]!;
   const item = body.map(line => line.match(LIST_ITEM)).find(Boolean);
   if (item) {
      shape.bullet = item[1]!;
      shape.hasBullets = true;
   }
   const firstContent = body.find(line => !isStructural(line) && !HEADING.test(line));
   shape.itemLines = Boolean(firstContent && LIST_ITEM.test(firstContent));
   return shape;
}

/** Join entry blocks with one blank line between them. */
const entries = (blocks: string[][]) => blocks.filter(block => block.length).flatMap((block, index) => (index ? ["", ...block] : block));

function renderSection(kind: ContentKind, profile: CvProfileProps, shape: SectionShape, inlineLanguages: boolean): string[] {
   const bullets = (items: string[]) => items.map(item => item.trim()).filter(Boolean).map(item => `${shape.bullet}${item}`);
   const block = (head: string[], tail: string[]) => (tail.length ? [...head, "", ...tail] : head);
   switch (kind) {
      case "summary":
         return entries(paragraphs(profile.identity.summary).map(text => [text]));

      case "experience":
         return entries(profile.experiences.map((entry) => {
            const dates = joinDates(entry.start, entry.end);
            if (shape.layout === "table") {
               return block([
                  `| ${cell(wrap(entry.company, shape.strong))} | ${cell(entry.location)} |`,
                  shape.separator,
                  `| ${cell(entry.title)} | ${cell(dates)} |`,
               ], bullets(entry.highlights));
            }
            const meta = [dates, entry.location].filter(Boolean).join(" · ");
            const title = [entry.title, entry.company].filter(Boolean).join(" — ");
            return [`${shape.hashes} ${title}`, ...(meta ? [wrap(meta, shape.meta)] : []), ...bullets(entry.highlights)];
         }));

      case "education":
         return entries(profile.education.map((entry) => {
            const dates = joinDates(entry.start, entry.end);
            const details = paragraphs(entry.details);
            if (shape.layout === "table") {
               return block([
                  `| ${cell(wrap(entry.school, shape.strong))} | ${cell(entry.location)} |`,
                  shape.separator,
                  `| ${cell(entry.degree)} | ${cell(dates)} |`,
               ], details);
            }
            const meta = [entry.degree ? entry.school : "", dates, entry.location].filter(Boolean).join(" · ");
            return [`${shape.hashes} ${entry.degree || entry.school}`, ...(meta ? [wrap(meta, shape.meta)] : []), ...details];
         }));

      case "projects":
         return entries(profile.projects.map((entry) => {
            const [lead = "", ...rest] = entry.description.split("\n").map(line => line.trim()).filter(Boolean);
            const description = [
               ...(lead ? [lead] : []),
               ...(rest.length && shape.hasBullets ? ["", ...bullets(rest)] : rest.flatMap(line => ["", line])),
            ];
            const technologies = entry.technologies.length ? [`Technologies: ${entry.technologies.join(", ")}`] : [];
            const tail = description.length && technologies.length ? [...description, "", ...technologies] : [...description, ...technologies];
            if (shape.layout === "table") {
               return block([`| ${cell(wrap(entry.name, shape.strong))} | ${cell(link(entry.url))} |`, shape.separator], tail);
            }
            return block([`${shape.hashes} ${entry.url ? link(entry.url, entry.name) : entry.name}`], tail);
         }));

      case "skills": {
         const lines = profile.skills
            .filter(group => group.skills.length)
            .map(group => `**${group.name.trim() || "General"}:** ${group.skills.join(", ")}`);
         const languages = profile.languages.filter(item => item.trim());
         if (inlineLanguages && languages.length) lines.push(`**Languages:** ${languages.join(", ")}`);
         return shape.itemLines ? lines.map(line => `${shape.bullet}${line}`) : entries(lines.map(line => [line]));
      }

      case "certifications":
         return profile.certifications.map(item => item.name.trim()).filter(Boolean).map(name => `${shape.bullet}${name}`);

      case "languages": {
         const languages = profile.languages.map(item => item.trim()).filter(Boolean);
         return shape.itemLines ? bullets(languages) : [languages.join(", ")];
      }
   }
}

function renderHeader(header: string[], profile: CvProfileProps): string[] {
   const name = profile.identity.fullName.trim();
   const contacts = contactLine(profile);
   const headline = profile.identity.headline.trim();
   if (!header.length) {
      return [`# ${name}`, ...(headline ? ["", `**${headline}**`] : []), ...(contacts ? ["", contacts] : [])];
   }

   const [nameLine = "", ...rest] = header;
   const out = [`# ${name}${attributesOf(nameLine.replace(HEADING, "$2"))}`];
   let contactsDone = false;
   let headlineDone = false;
   for (const line of rest) {
      if (isStructural(line)) { out.push(line); continue; }
      const body = line.trim().replace(ATTRIBUTES, "");
      const isContactLine = body.split(TOKEN_SEPARATOR).some(token => classifyCvContact(token));
      if (isContactLine) {
         if (!contactsDone && contacts) out.push(`${contacts}${attributesOf(line)}`);
         contactsDone = true;
      } else if (!headlineDone) {
         headlineDone = true;
         const marker = body.match(WRAPPED)?.[1] ?? "";
         if (headline) out.push(`${wrap(headline, marker)}${attributesOf(line)}`);
      }
   }
   if (!contactsDone && contacts) out.push("", contacts);
   return out;
}

function collapseBlankLines(lines: string[]): string[] {
   const out: string[] = [];
   let fenced = false;
   for (const line of lines) {
      if (FENCE.test(line)) fenced = !fenced;
      if (!fenced && !line.trim() && !out[out.length - 1]?.trim() && out.length) continue;
      out.push(fenced ? line : line.trim() ? line : "");
   }
   return out;
}

function renderDefaultSections(profile: CvProfileProps, kinds: readonly ContentKind[]): string[] {
   return entries(kinds.filter(kind => hasContent(profile, kind)).map(kind => [
      `## ${DEFAULT_TITLES[kind]}`, "", ...renderSection(kind, profile, DEFAULT_SHAPE, false),
   ]));
}

function composeMustache(skeleton: string, profile: CvProfileProps): string {
   const fields = new Set([...skeleton.matchAll(MUSTACHE)].map(match => match[1]!));
   const values: Record<string, () => string> = {
      fullName: () => profile.identity.fullName.trim(),
      name: () => profile.identity.fullName.trim(),
      headline: () => profile.identity.headline.trim(),
      location: () => profile.identity.location.trim(),
      summary: () => paragraphs(profile.identity.summary).join("\n\n"),
      contacts: () => contactLine(profile),
      content: () => renderDefaultSections(profile, CONTENT_ORDER.filter(kind => !(kind === "summary" && fields.has("summary")))).join("\n"),
   };
   if (fields.has("content")) {
      const content = values.content!;
      const headline = fields.has("headline") ? "" : wrap(profile.identity.headline.trim(), "**");
      const contacts = fields.has("contacts") || fields.has("location") ? "" : contactLine(profile);
      values.content = () => [headline, contacts, content()].filter(Boolean).join("\n\n");
   }
   return skeleton.replace(MUSTACHE, (_, field: string) => values[field]?.() ?? "");
}

export interface ComposeCvMarkdownOptions {
   /** Append profile sections the skeleton has no heading for. Default true. */
   includeMissingSections?: boolean;
}

/**
 * Render `profile` into `skeleton`. Each `##` section keeps its heading text,
 * position, and entry shape (Harvard table rows, `###` headings with an italic
 * metadata line, or flat lists); only the first section of each kind receives
 * data. Sections without matching profile data are dropped while their
 * structural suffix (directives, page breaks) is preserved.
 */
export function composeCvMarkdown(skeleton: string, profile: CvProfileProps, options: ComposeCvMarkdownOptions = {}): string {
   if (HAS_MUSTACHE.test(skeleton)) return composeMustache(skeleton, profile);
   const includeMissing = options.includeMissingSections ?? true;
   const parsed = parseSkeleton(skeleton);
   const rendered = new Set<ContentKind>();
   const hasLanguagesSection = parsed.sections.some(section => section.kind === "languages");

   const blocks: Block[] = [{ content: renderHeader(parsed.header, profile), suffix: parsed.headerSuffix }];
   for (const section of parsed.sections) {
      const kind = section.kind;
      if (kind === "header" || kind === "other" || rendered.has(kind) || !hasContent(profile, kind)) {
         blocks.push({ content: [], suffix: section.suffix });
         continue;
      }
      rendered.add(kind);
      const inlineLanguages = kind === "skills" && !hasLanguagesSection;
      if (inlineLanguages) rendered.add("languages");
      blocks.push({
         content: [section.heading, "", ...renderSection(kind, profile, detectShape(section.body), inlineLanguages)],
         suffix: section.suffix,
      });
   }

   if (includeMissing) {
      const missing = CONTENT_ORDER.filter(kind => !rendered.has(kind) && hasContent(profile, kind));
      if (missing.includes("summary")) {
         blocks.splice(1, 0, { content: renderDefaultSections(profile, ["summary"]), suffix: [""] });
      }
      const trailing = missing.filter(kind => kind !== "summary");
      if (trailing.length) {
         const last = blocks[blocks.length - 1]!;
         blocks.push({ content: renderDefaultSections(profile, trailing), suffix: last.suffix });
         last.suffix = [""];
      }
   }

   const lines = [...parsed.prefix];
   blocks.forEach((block, index) => {
      if (block.content.length) {
         lines.push(...block.content);
         if (!block.suffix.length && index < blocks.length - 1) lines.push("");
      }
      lines.push(...block.suffix);
   });
   return collapseBlankLines(lines).join("\n");
}

/** Fill missing fields of an untrusted profile payload with empty values. */
export function normalizeCvProfile(raw: unknown): CvProfileProps {
   const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
   const text = (input: unknown) => (typeof input === "string" ? input : "");
   const list = <T>(input: unknown, map: (item: any) => T): T[] => (Array.isArray(input) ? input.map(map) : []);
   const strings = (input: unknown) => list(input, text).filter(Boolean);
   const identity = (value.identity && typeof value.identity === "object" ? value.identity : value) as Record<string, unknown>;
   return {
      version: Number.isInteger(value.version) && value.version > 0 ? value.version : 1,
      identity: {
         fullName: text(identity.fullName),
         headline: text(identity.headline),
         summary: text(identity.summary),
         location: text(identity.location),
      },
      contacts: list(value.contacts, item => ({
         kind: ["email", "phone", "linkedin", "github", "website"].includes(item?.kind) ? item.kind : "other",
         label: text(item?.label),
         value: text(item?.value),
      })),
      experiences: list(value.experiences, item => ({
         title: text(item?.title), company: text(item?.company), location: text(item?.location),
         start: text(item?.start), end: text(item?.end), highlights: strings(item?.highlights),
      })),
      skills: list(value.skills, item => ({ name: text(item?.name), skills: strings(item?.skills) })),
      certifications: list(value.certifications, item => ({ name: text(typeof item === "string" ? item : item?.name) })),
      education: list(value.education, item => ({
         degree: text(item?.degree), school: text(item?.school), location: text(item?.location),
         start: text(item?.start), end: text(item?.end), details: text(item?.details),
      })),
      projects: list(value.projects, item => ({
         name: text(item?.name), url: text(item?.url), description: text(item?.description), technologies: strings(item?.technologies),
      })),
      languages: strings(value.languages),
   };
}
