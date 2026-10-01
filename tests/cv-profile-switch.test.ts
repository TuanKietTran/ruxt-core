import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { composeCvMarkdown, normalizeCvProfile } from "../domain/cv/compose";
import { extractCvProfile, toCvTemplateSkeleton } from "../domain/cv/split";
import { CvApplication } from "../domain/cv/application";
import { CvProfile } from "../domain/cv/concept";
import type { CvProfileProps } from "../domain/cv/types";
import type { Handler } from "../cqrs";
import { runSaga, SagaError } from "../saga";
import { createComposeCvProfileHandler } from "../handlers/compose-cv-profile";
import { createGetCvDocumentHandler } from "../handlers/get-cv-document";
import { createSaveCvSourceHandler } from "../handlers/save-cv-source";
import { createUpdateCvApplicationProfileHandler } from "../handlers/update-cv-application-profile";
import { createSwitchCvProfileHandler, type SwitchCvProfileOutput } from "../handlers/switch-cv-profile";
import {
   InMemoryCvApplicationRepo,
   InMemoryCvDocumentRepo,
   InMemoryCvTemplateRepo,
   makeTemplate,
} from "./helpers/fakes";

const templateJson = (name: string) =>
   JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8"));
const harvard = templateJson("harvard.v1.json");
const pipeline = templateJson("pipeline-default.v1.json");

const ada: CvProfileProps = {
   version: 1,
   identity: { fullName: "Ada Lovelace", headline: "Analyst", summary: "Pioneer of computing.", location: "London, UK" },
   contacts: [
      { kind: "email", label: "", value: "ada@example.com" },
      { kind: "github", label: "", value: "https://github.com/ada" },
   ],
   experiences: [
      { title: "Engineer", company: "Babbage Co", location: "London, UK", start: "Jan 1840", end: "Present", highlights: ["Wrote the first program", "Kept | pipes"] },
      { title: "Tutor", company: "Home", location: "", start: "1835", end: "1839", highlights: [] },
   ],
   skills: [{ name: "Math", skills: ["Calculus", "Algebra"] }],
   certifications: [{ name: "Royal Society" }],
   education: [{ degree: "Private tutoring", school: "Home School", location: "London, UK", start: "1820", end: "1832", details: "Studied with De Morgan" }],
   projects: [{ name: "Note G", url: "https://example.com/g", description: "Bernoulli algorithm\nPublished 1843", technologies: ["Analytical Engine"] }],
   languages: ["English (native)", "French (fluent)"],
};

const grace: CvProfileProps = {
   ...normalizeCvProfile({}),
   identity: { fullName: "Grace Hopper", headline: "", summary: "", location: "Arlington, VA" },
   experiences: [{ title: "Rear Admiral", company: "US Navy", location: "", start: "1943", end: "1986", highlights: ["Built COBOL"] }],
};

describe("composeCvMarkdown", () => {
   it("fills the Harvard table layout and round-trips through extraction", () => {
      const markdown = composeCvMarkdown(harvard.markdownSkeleton, ada);
      expect(markdown).toMatch(/^:::resume\n\n# Ada Lovelace \{\.cv-name\}/);
      expect(markdown).toContain("| **Babbage Co** | London, UK |\n| :-- | --: |\n| Engineer | Jan 1840 – Present |");
      expect(markdown).toContain("- Kept | pipes");
      expect(markdown).not.toMatch(/YOUR NAME|ORGANIZATION|Month Year|Leadership/);
      expect(markdown.trimEnd().endsWith(":::")).toBe(true);

      const extracted = extractCvProfile(markdown);
      const { headline: _headline, ...identity } = ada.identity;
      expect(extracted.identity).toMatchObject(identity);
      expect(extracted.experiences).toEqual(ada.experiences);
      expect(extracted.education).toEqual(ada.education);
      expect(extracted.projects).toEqual(ada.projects);
      expect(extracted.skills).toEqual(ada.skills);
      expect(extracted.certifications).toEqual(ada.certifications);
      expect(extracted.languages).toEqual(ada.languages);
      expect(extracted.contacts.map(contact => contact.value)).toEqual(["ada@example.com", "https://github.com/ada"]);
   });

   it("keeps a session's layout when the profile is switched", () => {
      const session = composeCvMarkdown(harvard.markdownSkeleton, ada);
      const switched = composeCvMarkdown(toCvTemplateSkeleton(session), grace);
      expect(switched).toContain("# Grace Hopper {.cv-name}");
      expect(switched).toContain("| **US Navy** |  |\n| :-- | --: |\n| Rear Admiral | 1943 – 1986 |");
      expect(switched).not.toMatch(/Ada|Babbage|## Projects|## Education|Placeholder|Highlight/);
      expect(extractCvProfile(switched).experiences).toEqual(grace.experiences);
   });

   it("is deterministic when re-applied to its own inferred skeleton", () => {
      const once = composeCvMarkdown(harvard.markdownSkeleton, ada);
      expect(composeCvMarkdown(toCvTemplateSkeleton(once), ada)).toBe(once);
   });

   it("renders the heading layout used by pipeline documents", () => {
      const skeleton = "# YOUR NAME\n\n## Experience\n\n### Entry title\n*Month Year – Month Year · City, Country*\n- Highlight\n";
      const markdown = composeCvMarkdown(skeleton, grace);
      expect(markdown).toContain("### Rear Admiral — US Navy\n*1943 – 1986*\n- Built COBOL");
      expect(extractCvProfile(markdown).experiences).toEqual(grace.experiences);
   });

   it("fills mustache skeletons such as the pipeline default template", () => {
      const markdown = composeCvMarkdown(pipeline.markdownSkeleton, ada);
      expect(markdown).toMatch(/^# Ada Lovelace\n\n\*\*Analyst\*\*\n\nLondon, UK · \[ada@example.com\]/);
      expect(markdown).toContain("## Experience\n\n### Engineer — Babbage Co");
      expect(markdown).not.toContain("{{");
   });

   it("appends profile sections the skeleton lacks unless disabled", () => {
      const skeleton = ":::resume\n\n# YOUR NAME\n\n## Experience\n\n- Highlight\n\n:::\n";
      const markdown = composeCvMarkdown(skeleton, ada);
      expect(markdown.indexOf("## Summary")).toBeLessThan(markdown.indexOf("## Experience"));
      expect(markdown.indexOf("## Certifications")).toBeLessThan(markdown.lastIndexOf(":::"));
      expect(composeCvMarkdown(skeleton, ada, { includeMissingSections: false })).not.toContain("## Summary");
   });
});

describe("normalizeCvProfile", () => {
   it("fills missing collections and drops malformed values", () => {
      const profile = normalizeCvProfile({ identity: { fullName: "A" }, contacts: [{ kind: "fax", value: "1" }], skills: "x" });
      expect(profile.version).toBe(1);
      expect(profile.contacts).toEqual([{ kind: "other", label: "", value: "1" }]);
      expect(profile.skills).toEqual([]);
      expect(profile.identity).toEqual({ fullName: "A", headline: "", summary: "", location: "" });
   });
});

describe("runSaga", () => {
   it("compensates completed steps in reverse and reports failures", async () => {
      const log: string[] = [];
      const steps = ["a", "b", "c"].map(name => ({
         name,
         run: async () => { if (name === "c") throw new Error("CV template not found"); log.push(`run:${name}`); },
         compensate: async () => { if (name === "a") throw new Error("gone"); log.push(`undo:${name}`); },
      }));
      const error = await runSaga("Test", steps, {}).catch(caught => caught);
      expect(error).toBeInstanceOf(SagaError);
      expect(error).toMatchObject({
         message: "CV template not found", failedStep: "c", compensated: ["b"],
         compensationFailures: [{ step: "a", error: "gone" }],
      });
      expect(log).toEqual(["run:a", "run:b", "undo:b"]);
   });
});

function localMediator(handlers: Handler<any, any>[]) {
   const byType = new Map(handlers.map(handler => [handler.type, handler]));
   return {
      async send<T>(request: any): Promise<T> {
         const result = await byType.get(request.requestName)!.execute(request.payload);
         if (!result.success) throw new Error(result.error);
         return result.data as T;
      },
   };
}

describe("SwitchCvProfile saga", () => {
   let documents: InMemoryCvDocumentRepo;
   let templates: InMemoryCvTemplateRepo;
   let applications: InMemoryCvApplicationRepo;
   let switchProfile: ReturnType<typeof createSwitchCvProfileHandler>;

   const run = async (payload: Parameters<typeof switchProfile.execute>[0]) => {
      const result = await switchProfile.execute(payload);
      if (!result.success) throw new Error(result.error);
      return result.data as SwitchCvProfileOutput;
   };

   beforeEach(async () => {
      documents = new InMemoryCvDocumentRepo();
      templates = new InMemoryCvTemplateRepo([
         makeTemplate({ markdownSkeleton: harvard.markdownSkeleton, css: ".harvard {}" }),
         makeTemplate({ id: "private", tags: ["local"], builtIn: false, markdownSkeleton: pipeline.markdownSkeleton, css: ".private {}" }),
      ]);
      applications = new InMemoryCvApplicationRepo();
      const mediator = localMediator([
         createGetCvDocumentHandler(documents),
         createSaveCvSourceHandler(documents),
         createComposeCvProfileHandler({ documents, templates }),
         createUpdateCvApplicationProfileHandler({ applications, templates }, { now: () => "2026-02-01T00:00:00.000Z" }),
      ]);
      switchProfile = createSwitchCvProfileHandler({ mediator });

      await documents.createCvDocument("cv", { markdown: composeCvMarkdown(harvard.markdownSkeleton, ada), css: ".session {}" });
      const template = (await templates.get("harvard", 1))!;
      await applications.create(CvApplication.create({
         id: "cv", ownerId: "owner", revision: 1, status: "draft",
         createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
         template: { ref: { id: "harvard", version: 1 }, value: template },
         profile: { ref: { id: "import:profile", version: 1 }, value: CvProfile.create(ada) },
      }));
   });

   it("re-renders the session and re-snapshots the owner's application", async () => {
      const result = await run({ documentId: "cv", profile: grace, profileId: "profile-grace", ownerId: "owner", expectedRevision: 1, sourceId: "tab" });
      expect(result.document.revision).toBe(2);
      expect(result.document.css).toBe(".session {}");
      expect(result.document.markdown).toContain("# Grace Hopper {.cv-name}");
      expect(result.template).toBeUndefined();
      expect(result.application?.revision).toBe(2);
      expect(result.application?.profile.ref).toEqual({ id: "profile-grace", version: 1 });
      expect(result.application?.profile.value.identity.fullName).toBe("Grace Hopper");
      expect(documents.events.at(-1)).toEqual({ id: "cv", sourceId: "tab" });
   });

   it("switches template and profile together", async () => {
      const result = await run({ documentId: "cv", profile: grace, template: { id: "private" }, ownerId: "owner" });
      expect(result.document.css).toBe(".private {}");
      expect(result.document.markdown).toMatch(/^# Grace Hopper\n/);
      expect(result.template).toEqual({ id: "private", version: 1 });
      expect(result.application?.template.ref).toEqual({ id: "private", version: 1 });
   });

   it("works without an owner and leaves applications untouched", async () => {
      const result = await run({ documentId: "cv", profile: grace });
      expect(result.application).toBeNull();
      expect((await applications.get("cv", "owner"))?.profile.value.identity.fullName).toBe("Ada Lovelace");
   });

   it("hides non-public templates from anonymous callers", async () => {
      await expect(run({ documentId: "cv", profile: grace, template: { id: "private" }, publicOnly: true })).rejects.toThrow("CV template not found");
      expect((await documents.getCvDocument("cv")).revision).toBe(1);
   });

   it("rejects stale revisions and invalid profiles before writing", async () => {
      await expect(run({ documentId: "cv", profile: grace, expectedRevision: 7 })).rejects.toThrow("Revision conflict");
      await expect(run({ documentId: "cv", profile: { identity: { fullName: " " } } })).rejects.toThrow("Invalid profile");
      expect(documents.events).toHaveLength(1);
   });

   it("compensates the document write when the application step fails", async () => {
      const before = await documents.getCvDocument("cv");
      applications.failNextUpdate = new Error("storage unavailable");
      await expect(run({ documentId: "cv", profile: grace, ownerId: "owner", sourceId: "tab" })).rejects.toThrow("storage unavailable");
      const after = await documents.getCvDocument("cv");
      expect(after.markdown).toBe(before.markdown);
      expect(after.css).toBe(before.css);
      expect(after.revision).toBe(3);
      expect(documents.events.map(event => event.sourceId)).toEqual([undefined, "tab", "tab:compensate"]);
   });

   it("lets a newer concurrent edit win over compensation and reports it", async () => {
      applications.update = async () => {
         await documents.updateCvDocument("cv", { markdown: "# Concurrent edit" });
         throw new Error("storage unavailable");
      };
      const error = await switchProfile.execute({ documentId: "cv", profile: grace, ownerId: "owner" });
      expect(error).toEqual({ success: false, error: "storage unavailable" });
      expect((await documents.getCvDocument("cv")).markdown).toBe("# Concurrent edit");
   });
});
