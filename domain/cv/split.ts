import type {
   CvContact,
   CvContactKind,
   CvEducation,
   CvExperience,
   CvProfileProps,
   CvProject,
} from "./types";

/** One CV session divided into reusable presentation and personal profile data. */
export interface CvSplitResult {
   profile: CvProfileProps;
   markdownSkeleton: string;
}

export type CvSectionKind =
   | "header" | "summary" | "experience" | "education" | "skills"
   | "projects" | "certifications" | "languages" | "other";
type SectionKind = CvSectionKind;

type Block =
   | { type: "heading"; level: number; text: string }
   | { type: "table"; rows: string[][] }
   | { type: "item"; text: string }
   | { type: "paragraph"; lines: string[] };

// Order matters: "Skills & Interests" is skills, "Technical Projects" is projects.
const SECTION_KINDS: ReadonlyArray<readonly [SectionKind, RegExp]> = [
   ["languages", /^languages?$/i],
   ["summary", /summary|profile|about|objective/i],
   ["education", /education|academic/i],
   ["projects", /project/i],
   ["certifications", /certificat|licen[cs]e|award/i],
   ["skills", /skill|technolog|competenc|interest|tool/i],
   ["experience", /experience|employment|work|career|leadership|activit|volunteer/i],
];

const ATTRIBUTES = /\s*\{[^{}]+\}\s*$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const LIST_ITEM = /^(\s*(?:[-*+]|\d+[.)])\s+)(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*(?::?-+:?\s*)?\|?\s*$/;
const DIRECTIVE = /^\s*:{3,}/;
const THEMATIC_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*(?:`{3,}|~{3,})/;
const EMPHASIS = /^(\*\*|\*|_)(\S(?:.*\S)?)\1$/;
const LABELLED = /^\*\*([^*]+?)(?::\*\*|\*\*:)\s*(.*)$/;
// `**Languages** &nbsp; C#, Rust`: a bold label separated by spacing instead of a colon.
const BOLD_LABEL = /^\*\*([^*]+?)\*\*(?:\s|&nbsp;|&#160;)+(\S.*)$/i;
const ITALIC_ONLY = /^(\*|_)(?!\1)(\S(?:.*\S)?)\1$/;
const TRAILING_SEPARATOR = /\s*[·•|]\s*$/;
const LABEL_PREFIX = /^([A-Z][\w &/-]{1,40}):\s+\S/;
const TOKEN_SEPARATOR = /\s+[·•|]\s+/;
const ENTRY_TITLE_SEPARATOR = /\s+(?:—|–|\||@|at)\s+/i;
const DATE_LIKE = /\b(?:\d{4}|present|current|now|month\s+year)\b/i;
const LOCATION_LIKE = /^[^,]{1,40},\s*[^,]{1,40}$/;
const SPOKEN_LANGUAGE = /\(|native|fluent|proficien|bilingual|conversational|basic|intermediate|advanced|\b[ABC][12]\b/i;
const TECHNOLOGIES = /^(?:tech(?:nolog(?:y|ies))?|tech stack|stack|built with|tools)\s*:\s*(.*)$/i;
const PLACEHOLDER_DATES = "Month Year – Month Year";

const CONTACT_PLACEHOLDERS: Record<CvContactKind, string> = {
   email: "[email@example.com](mailto:email@example.com)",
   phone: "+1 555 0100",
   linkedin: "[linkedin.com/in/your-name](https://linkedin.com/in/your-name)",
   github: "[github.com/your-name](https://github.com/your-name)",
   website: "[example.com](https://example.com)",
   other: "Contact",
};

const stripAttributes = (text: string) => text.replace(ATTRIBUTES, "");
const attributesOf = (text: string) => {
   const match = text.match(ATTRIBUTES);
   return match ? ` ${match[0].trim()}` : "";
};
const unwrapEmphasis = (text: string) => text.match(EMPHASIS)?.[2] ?? text;
const firstLink = (text: string) => text.match(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)/)?.[1] ?? "";
const tableCells = (line: string) =>
   line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(cell => cell.trim());
const append = (current: string, next: string, separator: string) =>
   !next ? current : current ? `${current}${separator}${next}` : next;

/** Markdown inline source reduced to readable text. */
export function plainCvText(text: string): string {
   return stripAttributes(text)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<((?:https?:|mailto:)[^>\s]+|[^\s<>@]+@[^\s<>@]+)>/gi, "$1")
      .replace(/\*\*|__|`/g, "")
      .replace(/(^|[\s(])[*_](\S(?:[^*_]*\S)?)[*_](?=$|[\s),.;:])/g, "$1$2")
      .replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ({ amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'" })[name]!)
      .replace(/\s+/g, " ")
      .trim();
}

const splitItems = (text: string) => plainCvText(text).split(/\s*[,;]\s*/).map(item => item.trim()).filter(Boolean);
const splitDates = (text: string) => {
   const [start = "", ...rest] = plainCvText(text).split(/\s+(?:–|—|-|to)\s+/i);
   return { start: start.trim(), end: rest.join(" – ").trim() };
};
const isEmphasisLine = (line: string) => {
   const body = stripAttributes(line).trim();
   return EMPHASIS.test(body) && !LABELLED.test(body);
};
const metaTokens = (line: string) =>
   unwrapEmphasis(stripAttributes(line).trim()).split(TOKEN_SEPARATOR).map(plainCvText).filter(Boolean);
const sectionKind = (title: string): SectionKind =>
   SECTION_KINDS.find(([, pattern]) => pattern.test(title))?.[0] ?? "other";

/** Classify a `#`/`##` section heading by the profile field it presents. */
export const classifyCvSection = (title: string): CvSectionKind => sectionKind(plainCvText(title));

/** Classify one contact token such as a mailto link, phone number, or profile URL. */
export function classifyCvContact(token: string): CvContact | null {
   const label = plainCvText(token);
   if (!label) return null;
   const target = firstLink(token) || token.match(/<([^>\s]+)>/)?.[1] || label;
   const email = target.replace(/^mailto:/i, "");
   if (/^mailto:/i.test(target) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { kind: "email", label, value: email };
   if (/^tel:/i.test(target)) return { kind: "phone", label, value: target.slice(4) };
   if (/linkedin\.com/i.test(target)) return { kind: "linkedin", label, value: target };
   if (/github\.com/i.test(target)) return { kind: "github", label, value: target };
   if (/^(?:https?:\/\/|www\.)/i.test(target) || /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(target)) {
      return { kind: "website", label, value: target };
   }
   const digits = label.replace(/\D/g, "");
   if (/^\+?[\d\s().-]+$/.test(label) && digits.length >= 7 && digits.length <= 15) return { kind: "phone", label, value: label };
   return null;
}

function tokenizeCvMarkdown(markdown: string): Block[] {
   const blocks: Block[] = [];
   let paragraph: string[] = [];
   let table: string[][] | null = null;
   let fenced = false;
   const flush = () => {
      if (paragraph.length) blocks.push({ type: "paragraph", lines: paragraph });
      if (table) blocks.push({ type: "table", rows: table });
      paragraph = [];
      table = null;
   };

   for (const line of markdown.split(/\r?\n/)) {
      if (FENCE.test(line)) { flush(); fenced = !fenced; continue; }
      if (fenced || TABLE_SEPARATOR.test(line)) continue;
      if (TABLE_ROW.test(line)) {
         if (paragraph.length) flush();
         (table ??= []).push(tableCells(line));
         continue;
      }
      if (table) flush();
      if (!line.trim() || DIRECTIVE.test(line) || THEMATIC_BREAK.test(line)) { flush(); continue; }
      const heading = line.match(HEADING);
      if (heading) { flush(); blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! }); continue; }
      const item = line.match(LIST_ITEM);
      if (item) { flush(); blocks.push({ type: "item", text: item[2]! }); continue; }
      paragraph.push(line.trim().replace(/\s*\\$/, ""));
   }
   flush();
   return blocks;
}

/**
 * Heuristically map a rendered CV session to the canonical profile. Supports the
 * Harvard table layout and the pipeline `###` + italic metadata layout.
 */
export function extractCvProfile(markdown: string): CvProfileProps {
   const profile: CvProfileProps = {
      version: 1,
      identity: { fullName: "", headline: "", summary: "", location: "" },
      contacts: [], experiences: [], skills: [], certifications: [], education: [], projects: [], languages: [],
   };
   const { identity } = profile;
   const summary: string[] = [];
   let section: SectionKind = "header";
   let experience: CvExperience | undefined;
   let education: CvEducation | undefined;
   let project: CvProject | undefined;

   const closeEntries = () => { experience = undefined; education = undefined; project = undefined; };
   const currentExperience = (fresh = false): CvExperience => {
      if (experience && (!fresh || (!experience.title && !experience.company && !experience.highlights.length))) return experience;
      experience = { title: "", company: "", location: "", start: "", end: "", highlights: [] };
      profile.experiences.push(experience);
      return experience;
   };
   const currentEducation = (fresh = false): CvEducation => {
      if (education && (!fresh || (!education.school && !education.degree && !education.details))) return education;
      education = { degree: "", school: "", location: "", start: "", end: "", details: "" };
      profile.education.push(education);
      return education;
   };
   const currentProject = (fresh = false): CvProject => {
      if (project && (!fresh || (!project.name && !project.description))) return project;
      project = { name: "", url: "", description: "", technologies: [] };
      profile.projects.push(project);
      return project;
   };

   const addSkills = (text: string) => {
      const body = stripAttributes(text).trim();
      const labelled = body.match(LABELLED) ?? body.match(BOLD_LABEL);
      if (labelled) {
         const name = plainCvText(labelled[1]!);
         const items = splitItems(labelled[2]!);
         if (/^languages?$/i.test(name) && items.some(item => SPOKEN_LANGUAGE.test(item))) profile.languages.push(...items);
         else if (items.length) profile.skills.push({ name, skills: items });
         return;
      }
      const items = splitItems(text);
      if (!items.length) return;
      let general = profile.skills.find(group => group.name === "General");
      if (!general) profile.skills.push(general = { name: "General", skills: [] });
      general.skills.push(...items);
   };

   const addHeaderLine = (line: string) => {
      const body = stripAttributes(line).trim().replace(TRAILING_SEPARATOR, "");
      if (!body) return;
      const tokens = body.split(TOKEN_SEPARATOR).filter(Boolean);
      const contacts = tokens.map(classifyCvContact);
      if (contacts.some(Boolean)) {
         tokens.forEach((token, index) => {
            const contact = contacts[index];
            if (contact) profile.contacts.push(contact);
            else if (!identity.location && LOCATION_LIKE.test(plainCvText(token))) identity.location = plainCvText(token);
            else if (!identity.headline) identity.headline = plainCvText(token);
            else if (!identity.location) identity.location = plainCvText(token);
         });
         return;
      }
      const text = plainCvText(body);
      if (tokens.length > 1) {
         identity.headline ||= plainCvText(tokens[0]!);
         identity.location ||= plainCvText(tokens[tokens.length - 1]!);
      } else if (!identity.headline && text.length <= 120) identity.headline = text;
      else summary.push(text);
   };

   const addTable = (rows: string[][]) => {
      const [head = [], sub = []] = rows;
      const [first = "", second = ""] = head;
      const [third = ""] = sub;
      const headText = head.map(plainCvText);
      const subText = sub.map(plainCvText);
      const isDate = (text: string) => DATE_LIKE.test(text) && text.length <= 40;
      // Any column after the first may hold the dates; the rest is place or detail.
      const dateIn = (cells: string[]) => cells.slice(1).find(isDate) ?? "";
      const placeIn = (cells: string[]) => cells.slice(1).reverse().find(text => text && !isDate(text)) ?? "";
      const headDate = dateIn(headText);
      const dates = splitDates(headDate || dateIn(subText));
      const place = headDate ? placeIn(subText) : placeIn(headText);
      const details = subText.slice(1).filter(text => text && !isDate(text) && text !== place).join(" · ");
      switch (section) {
         case "experience": {
            // `| *Role* | dates |` under a company table is another role at that company.
            const previous = profile.experiences.at(-1);
            if (!sub.length && previous?.company && ITALIC_ONLY.test(stripAttributes(first).trim())) {
               Object.assign(currentExperience(true), { company: previous.company, title: plainCvText(first), location: previous.location, ...dates });
               break;
            }
            Object.assign(currentExperience(true), { company: plainCvText(first), title: plainCvText(third), location: place, ...dates });
            break;
         }
         case "education":
            Object.assign(currentEducation(true), { school: plainCvText(first), degree: plainCvText(third), location: place, ...dates, details });
            break;
         case "projects":
            Object.assign(currentProject(true), {
               name: plainCvText(first),
               url: firstLink(second) || firstLink(first) || (classifyCvContact(second)?.kind === "website" ? plainCvText(second) : ""),
            });
            break;
         case "skills":
            for (const [name = "", items = ""] of rows) addSkills(items ? `**${plainCvText(name)}:** ${items}` : name);
            break;
         case "certifications":
            for (const [name = ""] of rows) if (plainCvText(name)) profile.certifications.push({ name: plainCvText(name) });
            break;
         case "languages":
            for (const row of rows) profile.languages.push(...splitItems(row[0] ?? ""));
            break;
      }
   };

   const addLine = (line: string, isItem: boolean) => {
      const text = plainCvText(line);
      if (!text) return;
      const meta = !isItem && isEmphasisLine(line);
      switch (section) {
         case "header":
            addHeaderLine(line);
            break;
         case "experience": {
            const entry = currentExperience();
            if (!meta) { entry.highlights.push(text); break; }
            for (const token of metaTokens(line)) {
               if (DATE_LIKE.test(token) && !entry.start) Object.assign(entry, splitDates(token));
               else if (!entry.location) entry.location = token;
               else if (!entry.company) entry.company = token;
            }
            break;
         }
         case "education": {
            const entry = currentEducation();
            if (!meta) { entry.details = append(entry.details, text, " "); break; }
            for (const token of metaTokens(line)) {
               if (DATE_LIKE.test(token) && !entry.start) Object.assign(entry, splitDates(token));
               else if (!entry.school) entry.school = token;
               else if (!entry.location) entry.location = token;
            }
            break;
         }
         case "projects": {
            const entry = currentProject();
            const technologies = text.match(TECHNOLOGIES);
            if (technologies) entry.technologies.push(...splitItems(technologies[1]!));
            else entry.description = append(entry.description, text, "\n");
            break;
         }
         case "skills":
            addSkills(line);
            break;
         case "certifications":
            profile.certifications.push({ name: text });
            break;
         case "languages":
            profile.languages.push(...splitItems(line));
            break;
      }
   };

   for (const block of tokenizeCvMarkdown(markdown)) {
      if (block.type === "heading") {
         const text = plainCvText(block.text);
         if (block.level === 1 && !identity.fullName) {
            identity.fullName = text;
            section = "header";
            closeEntries();
         } else if (block.level <= 2) {
            section = sectionKind(text);
            closeEntries();
         } else if (section === "experience") {
            const [title = "", company = ""] = text.split(ENTRY_TITLE_SEPARATOR);
            Object.assign(currentExperience(true), { title, company });
         } else if (section === "education") {
            const [degree = "", school = ""] = text.split(ENTRY_TITLE_SEPARATOR);
            Object.assign(currentEducation(true), { degree, school });
         } else if (section === "projects") {
            Object.assign(currentProject(true), { name: text, url: firstLink(block.text) });
         }
         continue;
      }
      if (block.type === "table") { addTable(block.rows); continue; }
      const lines = block.type === "item" ? [block.text] : block.lines;
      if (section === "summary") { summary.push(plainCvText(lines.join(" "))); continue; }
      for (const line of lines) addLine(line, block.type === "item");
   }

   identity.summary = summary.filter(Boolean).join("\n\n");
   return profile;
}

function placeholderToken(token: string): string {
   const contact = classifyCvContact(token);
   if (contact) return CONTACT_PLACEHOLDERS[contact.kind];
   return DATE_LIKE.test(plainCvText(token)) ? PLACEHOLDER_DATES : "City, Country";
}

function placeholderText(text: string, fallback: string): string {
   const attributes = attributesOf(text);
   const body = stripAttributes(text).trim();
   if (!body) return text;
   const labelled = body.match(LABELLED);
   if (labelled) return `**${labelled[1]}:**${labelled[2] ? " Item, Item" : ""}${attributes}`;
   const emphasis = body.match(EMPHASIS);
   if (emphasis) return `${emphasis[1]}${placeholderText(emphasis[2]!, fallback)}${emphasis[1]}${attributes}`;
   const label = body.match(LABEL_PREFIX);
   if (label) return `${label[1]}: Item, Item${attributes}`;
   const tokens = body.split(TOKEN_SEPARATOR);
   if (tokens.length > 1) return `${tokens.map(placeholderToken).join(" · ")}${attributes}`;
   const contact = classifyCvContact(body);
   if (contact) return `${CONTACT_PLACEHOLDERS[contact.kind]}${attributes}`;
   if (DATE_LIKE.test(plainCvText(body)) && body.length <= 40) return `${PLACEHOLDER_DATES}${attributes}`;
   return `${fallback}${attributes}`;
}

/**
 * Keep a session's structure (directives, indicators, page breaks, section
 * headings, table/list shapes) while replacing personal text with placeholders.
 */
export function toCvTemplateSkeleton(markdown: string): string {
   let fenced = false;
   return markdown.split(/\r?\n/).map((line) => {
      if (FENCE.test(line)) { fenced = !fenced; return line; }
      if (fenced || !line.trim() || DIRECTIVE.test(line) || THEMATIC_BREAK.test(line) || TABLE_SEPARATOR.test(line)) return line;
      const heading = line.match(HEADING);
      if (heading) {
         const [, hashes = "", text = ""] = heading;
         if (hashes.length === 1) return `# YOUR NAME${attributesOf(text)}`;
         if (hashes.length === 2) return line;
         return `${hashes} ${placeholderText(text, "Entry title")}`;
      }
      if (TABLE_ROW.test(line)) return `| ${tableCells(line).map(cell => placeholderText(cell, "Detail")).join(" | ")} |`;
      const item = line.match(LIST_ITEM);
      if (item) return `${item[1]}${placeholderText(item[2]!, "Highlight")}`;
      return placeholderText(line, "Text");
   }).join("\n");
}

export function splitCvApplication(markdown: string): CvSplitResult {
   return { profile: extractCvProfile(markdown), markdownSkeleton: toCvTemplateSkeleton(markdown) };
}
