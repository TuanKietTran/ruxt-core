import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { composeCvMarkdown, normalizeCvProfile } from "../domain/cv/compose";
import { detectCvProfile, mergeCvProfileSections } from "../domain/cv/detect";
import { extractCvProfile, toCvTemplateSkeleton } from "../domain/cv/split";
import type { CvProfileProps } from "../domain/cv/types";
import type { Handler } from "../cqrs";
import { createApplyCvProfileHandler, type ApplyCvProfileOutput } from "../handlers/apply-cv-profile";
import { createComposeCvProfileHandler } from "../handlers/compose-cv-profile";
import { createDetectCvProfileHandler } from "../handlers/detect-cv-profile";
import { createGetCvDocumentHandler } from "../handlers/get-cv-document";
import { createSaveCvSourceHandler } from "../handlers/save-cv-source";
import { createSwitchCvProfileHandler } from "../handlers/switch-cv-profile";
import { InMemoryCvDocumentRepo, InMemoryCvTemplateRepo } from "./helpers/fakes";

const harvard = JSON.parse(readFileSync(fileURLToPath(new URL("./fixtures/harvard.v1.json", import.meta.url)), "utf8"));

// Multi-page layout with sub-role tables, a three-column education table,
// `**Label** &nbsp; items` skills and a header line ending in a separator.
const layered = `:::resume
# Mai Nguyen {.cv-name}
Da Nang, Vietnam · [mai@example.com](mailto:mai@example.com) · +84 900 000 000 ·  
[github.com/mai-example](https://github.com/mai-example)

## Objective

Backend engineer who likes reliable systems.

## Skills

**Languages** &nbsp; Go, TypeScript

**Cloud & DevOps** &nbsp; Azure, Podman

## Education

| **DA NANG UNIVERSITY** |  | Da Nang, Vietnam |
| :-- | :-: | --: |
| Bachelor’s degree, Software Engineering | GPA: 3.6 | Sep 2019 – Jun 2023 |

## Experience

| **ACME VIETNAM** | Da Nang, Vietnam |
| :-- | --: |
| Software Engineer | Jul 2023 – Present |

| *Senior Engineer* | Jan 2025 – Present |
| :-- | --: |

- Led the billing rewrite

| *Engineer* | Jul 2023 – Dec 2024 |
| :-- | --: |

- Shipped the mobile app

| **GLOBEX** | Hue, Vietnam |
| :-- | --: |
| Intern | Jun 2022 – Aug 2022 |

- Wrote **integration tests**

:::

---

:::resume
## Projects

| **LEDGER** | [github.com/mai-example/ledger](https://github.com/mai-example/ledger) &nbsp; **(MAINTAINER)** |
| :-- | --: |

Double-entry bookkeeping library

**Stack:** Go, PostgreSQL

:::
`;

const ada: CvProfileProps = {
   version: 1,
   identity: { fullName: "Ada Lovelace", headline: "", summary: "Pioneer of computing.", location: "London, UK" },
   contacts: [{ kind: "email", label: "", value: "ada@example.com" }, { kind: "github", label: "", value: "https://github.com/ada" }],
   experiences: [
      { title: "Engineer", company: "Babbage Co", location: "London, UK", start: "Jan 1840", end: "Present", highlights: ["Wrote the **first** program"] },
      { title: "Tutor", company: "Home", location: "London, UK", start: "1835", end: "1839", highlights: ["Taught the Engineer"] },
   ],
   skills: [{ name: "Math", skills: ["Calculus", "Algebra"] }],
   certifications: [{ name: "Royal Society" }],
   education: [{ degree: "Private tutoring", school: "Home School", location: "London, UK", start: "1820", end: "1832", details: "Studied with De Morgan" }],
   projects: [{ name: "Note G", url: "https://example.com/g", description: "Bernoulli algorithm\nPublished 1843", technologies: ["Analytical Engine"] }],
   languages: ["English (native)"],
};

const textAt = (markdown: string, path: string) => {
   const field = detectCvProfile(markdown).fields.find(item => item.path === path);
   return field?.ranges.map(range => markdown.slice(range.from, range.to));
};

describe("extractCvProfile layouts", () => {
   it("reads sub-roles, multi-column tables, bold-label skills and entities", () => {
      const profile = extractCvProfile(layered);
      expect(profile.contacts.map(contact => contact.label)).toEqual(["mai@example.com", "+84 900 000 000", "github.com/mai-example"]);
      expect(profile.identity.summary).toBe("Backend engineer who likes reliable systems.");
      expect(profile.skills).toEqual([{ name: "Languages", skills: ["Go", "TypeScript"] }, { name: "Cloud & DevOps", skills: ["Azure", "Podman"] }]);
      expect(profile.education).toEqual([{
         school: "DA NANG UNIVERSITY", degree: "Bachelor’s degree, Software Engineering", location: "Da Nang, Vietnam",
         start: "Sep 2019", end: "Jun 2023", details: "GPA: 3.6",
      }]);
      expect(profile.experiences.map(item => [item.company, item.title, item.location, item.start, item.end, item.highlights])).toEqual([
         ["ACME VIETNAM", "Software Engineer", "Da Nang, Vietnam", "Jul 2023", "Present", []],
         ["ACME VIETNAM", "Senior Engineer", "Da Nang, Vietnam", "Jan 2025", "Present", ["Led the billing rewrite"]],
         ["ACME VIETNAM", "Engineer", "Da Nang, Vietnam", "Jul 2023", "Dec 2024", ["Shipped the mobile app"]],
         ["GLOBEX", "Intern", "Hue, Vietnam", "Jun 2022", "Aug 2022", ["Wrote integration tests"]],
      ]);
      expect(profile.projects).toEqual([{ name: "LEDGER", url: "https://github.com/mai-example/ledger", description: "Double-entry bookkeeping library", technologies: ["Go", "PostgreSQL"] }]);
   });

   it("keeps single-dash alignment rows as separators in skeletons", () => {
      expect(toCvTemplateSkeleton(layered)).toContain("| :-- | :-: | --: |");
   });
});

describe("detectCvProfile", () => {
   it("locates every value of a composed Harvard session", () => {
      const markdown = composeCvMarkdown(harvard.markdownSkeleton, ada);
      const { profile, fields } = detectCvProfile(markdown);
      expect(profile.identity.fullName).toBe("Ada Lovelace");
      expect(fields.filter(field => !field.ranges.length)).toEqual([]);
      expect(textAt(markdown, "identity.fullName")).toEqual(["Ada Lovelace"]);
      expect(textAt(markdown, "contacts.1")).toEqual(["[github.com/ada](https://github.com/ada)"]);
      expect(textAt(markdown, "experiences.1.title")).toEqual(["Tutor"]);
      // "Engineer" also appears in entry 1's highlight; the title keeps to its own row.
      const title = detectCvProfile(markdown).fields.find(field => field.path === "experiences.0.title")!;
      expect(markdown.split("\n")[title.line! - 1]).toMatch(/^\| Engineer \|/);
      expect(textAt(markdown, "experiences.0.highlights.0")).toEqual(["Wrote the **first** program"]);
      expect(textAt(markdown, "projects.0.description")).toEqual(["Bernoulli algorithm", "Published 1843"]);
   });

   it("keeps each entry inside its block and shares values inherited from a parent table", () => {
      const { fields } = detectCvProfile(layered);
      expect(fields.filter(field => !field.ranges.length)).toEqual([]);
      const line = (path: string) => fields.find(field => field.path === path)!.line;
      const company = line("experiences.0.company");
      expect(line("experiences.1.company")).toBe(company);
      expect(line("experiences.2.location")).toBe(company);
      expect(line("experiences.3.location")).toBe(line("experiences.3.company"));
      expect(line("experiences.3.location")).not.toBe(company);
      expect(textAt(layered, "skills.1.skills.0")).toEqual(["Azure"]);
      expect(textAt(layered, "education.0.details")).toEqual(["GPA: 3.6"]);
   });

   it("reports nothing for an empty session", () => {
      expect(detectCvProfile("").fields).toEqual([]);
   });
});

describe("mergeCvProfileSections", () => {
   it("replaces only the chosen sections", () => {
      const detected = extractCvProfile(layered);
      const merged = mergeCvProfileSections(ada, detected, ["experiences", "skills"]);
      expect(merged.identity).toEqual(ada.identity);
      expect(merged.education).toEqual(ada.education);
      expect(merged.experiences).toEqual(detected.experiences);
      expect(merged.skills).toEqual(detected.skills);
      expect(ada.experiences).toHaveLength(2);
   });
});

function localMediator(handlers: Handler<any, any>[]) {
   const byType = new Map<string, Handler<any, any>>();
   const mediator = {
      async send<T>(request: any): Promise<T> {
         const result = await byType.get(request.requestName)!.execute(request.payload);
         if (!result.success) throw new Error(result.error);
         return result.data as T;
      },
   };
   for (const handler of handlers) byType.set(handler.type, handler);
   byType.set("SwitchCvProfile", createSwitchCvProfileHandler({ mediator }));
   return mediator;
}

describe("DetectCvProfile and ApplyCvProfile", () => {
   let documents: InMemoryCvDocumentRepo;
   let mediator: ReturnType<typeof localMediator>;
   const grace = { ...normalizeCvProfile({}), identity: { fullName: "Grace Hopper", headline: "", summary: "", location: "" } };

   beforeEach(async () => {
      documents = new InMemoryCvDocumentRepo();
      mediator = localMediator([
         createGetCvDocumentHandler(documents),
         createSaveCvSourceHandler(documents),
         createComposeCvProfileHandler({ documents, templates: new InMemoryCvTemplateRepo() }),
      ]);
      await documents.createCvDocument("one", { markdown: composeCvMarkdown(harvard.markdownSkeleton, ada), css: ".one {}" });
      await documents.createCvDocument("two", { markdown: layered, css: ".two {}" });
   });

   it("detects a stored session", async () => {
      const result = await createDetectCvProfileHandler(documents).execute({ documentId: "two" });
      expect(result.success && result.data.revision).toBe(1);
      expect(result.success && result.data.profile.identity.fullName).toBe("Mai Nguyen");
   });

   it("applies one profile to several sessions and reports each outcome", async () => {
      const apply = createApplyCvProfileHandler({ mediator });
      const result = await apply.execute({ profile: grace, documentIds: ["one", "two", "one", "missing"] });
      expect(result.success).toBe(true);
      const data = (result as { data: ApplyCvProfileOutput }).data;
      expect(data.results.map(item => [item.documentId, item.ok])).toEqual([["one", true], ["two", true], ["missing", false]]);
      expect([data.applied, data.failed]).toEqual([2, 1]);
      const [one, two] = await Promise.all([documents.getCvDocument("one"), documents.getCvDocument("two")]);
      expect(one.markdown).toContain("# Grace Hopper {.cv-name}");
      expect(one.css).toBe(".one {}");
      expect(two.markdown).toContain("# Grace Hopper {.cv-name}");
      expect(two.markdown).not.toMatch(/Mai|ACME|GLOBEX/);
   });

   it("rejects an invalid profile or target list before touching any session", async () => {
      const apply = createApplyCvProfileHandler({ mediator });
      expect(await apply.execute({ profile: { identity: { fullName: " " } }, documentIds: ["one"] })).toMatchObject({ success: false, error: expect.stringContaining("Invalid profile") });
      expect(await apply.execute({ profile: grace, documentIds: [] })).toMatchObject({ success: false, error: "documentIds is required" });
      expect(await apply.execute({ profile: grace, documentIds: Array.from({ length: 51 }, (_, index) => `cv-${index}`) })).toMatchObject({ success: false });
      expect((await documents.getCvDocument("one")).revision).toBe(1);
   });
});
