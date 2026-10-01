import { beforeEach, describe, expect, it } from "vitest";
import { createCvDocumentHandler } from "../handlers/create-cv-document";
import { createSaveCvSourceHandler } from "../handlers/save-cv-source";
import { createPatchCvSourceHandler } from "../handlers/patch-cv-source";
import { CvDocument } from "../domain/cv/document";
import { CvRevisionConflict, assertExpectedRevision } from "../domain/cv/version";
import type { CvDocumentRecord } from "../repos/cv-document.repo";
import { InMemoryCvDocumentRepo } from "./helpers/fakes";

const data = <T>(result: { success: boolean } & Record<string, unknown>) => (result as { data: T }).data;

describe("CvDocument invariants", () => {
   const props = { id: "doc", markdown: "# Hi", css: "", revision: 1, updatedAt: "2026-01-01T00:00:00.000Z" };

   it("accepts a well-formed document", () => {
      expect(CvDocument.create(props).toJSON()).toEqual(props);
   });

   it("rejects a blank id, non-string sources, and non-positive revisions", () => {
      expect(() => CvDocument.create({ ...props, id: " " })).toThrow("CvDocument requires an id");
      expect(() => CvDocument.create({ ...props, css: undefined as unknown as string })).toThrow("requires markdown and css");
      expect(() => CvDocument.create({ ...props, revision: 0 })).toThrow("positive integer");
   });
});

describe("assertExpectedRevision", () => {
   it("passes when the expectation matches", () => {
      expect(() => assertExpectedRevision(4, 4)).not.toThrow();
   });

   it("raises a typed conflict carrying both revisions", () => {
      try {
         assertExpectedRevision(2, 5);
         expect.unreachable();
      } catch (error) {
         expect(error).toBeInstanceOf(CvRevisionConflict);
         expect(error).toMatchObject({ name: "CvRevisionConflict", expectedRevision: 2, currentRevision: 5 });
      }
   });

   it("rejects a malformed expectation before comparing", () => {
      expect(() => assertExpectedRevision(0, 1)).toThrow("expectedRevision must be a positive integer");
   });
});

describe("CV document command handlers", () => {
   let repo: InMemoryCvDocumentRepo;

   beforeEach(() => { repo = new InMemoryCvDocumentRepo(); });

   const seed = () => createCvDocumentHandler(repo).execute({
      id: "master", title: "Master", markdown: "# Ada\n\nEngineer\n", css: ".resume {}", sourceId: "browser",
   });

   it("creates a document at revision 1", async () => {
      const record = data<CvDocumentRecord>(await seed());
      expect(record).toMatchObject({ id: "master", title: "Master", revision: 1 });
      expect(repo.events).toEqual([{ id: "master", sourceId: "browser" }]);
   });

   it("bumps the revision on each save and records the update source", async () => {
      await seed();
      const save = createSaveCvSourceHandler(repo);
      expect(data<CvDocumentRecord>(await save.execute({ id: "master", markdown: "# Ada v2", sourceId: "mcp" })).revision).toBe(2);
      expect(data<CvDocumentRecord>(await save.execute({ id: "master", css: ".resume { color: red }" })).revision).toBe(3);
      expect(repo.events.at(-1)).toEqual({ id: "master", sourceId: undefined });
   });

   it("fails a stale conditional save", async () => {
      await seed();
      const save = createSaveCvSourceHandler(repo);
      await save.execute({ id: "master", markdown: "first" });
      await expect(save.execute({ id: "master", markdown: "stale", expectedRevision: 1 }))
         .resolves.toEqual({ success: false, error: "CV document revision conflict" });
   });

   it("patches a uniquely matching fragment", async () => {
      await seed();
      const record = data<CvDocumentRecord>(await createPatchCvSourceHandler(repo).execute({
         id: "master", target: "markdown", oldText: "Engineer", newText: "Mathematician",
      }));
      expect(record.markdown).toContain("Mathematician");
      expect(record.revision).toBe(2);
   });

   it("refuses ambiguous and non-matching patches", async () => {
      await seed();
      const patch = createPatchCvSourceHandler(repo);
      await createSaveCvSourceHandler(repo).execute({ id: "master", markdown: "dup dup" });
      await expect(patch.execute({ id: "master", target: "markdown", oldText: "dup", newText: "x" }))
         .resolves.toEqual({ success: false, error: "oldText must match exactly once; found 2 matches" });
      await expect(patch.execute({ id: "master", target: "markdown", oldText: "absent", newText: "x" }))
         .resolves.toEqual({ success: false, error: "oldText must match exactly once; found 0 matches" });
   });

   it("reports a missing document rather than creating one", async () => {
      const result = await createSaveCvSourceHandler(repo).execute({ id: "ghost", markdown: "x" });
      expect(result).toEqual({ success: false, error: "CV document ghost not found" });
   });
});
