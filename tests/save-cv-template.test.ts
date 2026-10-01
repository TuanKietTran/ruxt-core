import { beforeEach, describe, expect, it } from "vitest";
import { createSaveCvTemplateHandler, saveCvTemplateCommand } from "../handlers/save-cv-template";
import { createCloneCvTemplateHandler } from "../handlers/clone-cv-template";
import type { CvTemplate } from "../domain/cv/template";
import { InMemoryCvTemplateRepo, makeTemplate } from "./helpers/fakes";

const options = { now: () => "2026-09-20T00:00:00.000Z", createId: () => "local-fixed" };
const input = { name: "My Layout", markdownSkeleton: "# YOUR NAME\n", css: ".resume {}\n" };

describe("saveCvTemplateCommand", () => {
   it("is a command addressed to the SaveCvTemplate handler", () => {
      expect(saveCvTemplateCommand(input)).toEqual({ _type: "command", requestName: "SaveCvTemplate", payload: input });
   });
});

describe("SaveCvTemplate — save as new", () => {
   let repo: InMemoryCvTemplateRepo;
   let handler: ReturnType<typeof createSaveCvTemplateHandler>;

   beforeEach(() => {
      repo = new InMemoryCvTemplateRepo();
      handler = createSaveCvTemplateHandler(repo, options);
   });

   it("persists a local, non-built-in version 1", async () => {
      const result = await handler.execute(input);
      expect(result.success).toBe(true);
      const template = (result as { data: CvTemplate }).data;
      expect(template.toJSON()).toEqual({
         id: "local-fixed",
         version: 1,
         name: "My Layout",
         markdownSkeleton: input.markdownSkeleton,
         css: input.css,
         capabilities: { pageFormats: ["A4"], supportsPhoto: false, atsFriendly: true },
         builtIn: false,
         tags: ["local"],
         createdAt: options.now(),
      });
      expect(await repo.get("local-fixed")).not.toBeNull();
   });

   it("trims and caps the name", async () => {
      const result = await handler.execute({ ...input, name: `  ${"n".repeat(200)}  ` });
      expect((result as { data: CvTemplate }).data.name.length).toBe(120);
   });

   it("rejects a blank name with a 400-mapped message", async () => {
      await expect(handler.execute({ ...input, name: "   " }))
         .resolves.toEqual({ success: false, error: "CV template name is required" });
   });

   it("rejects missing markdown or css", async () => {
      const result = await handler.execute({ ...input, css: undefined as unknown as string });
      expect(result).toEqual({ success: false, error: "markdownSkeleton and css are required" });
   });

   it("rejects oversized payloads", async () => {
      await expect(handler.execute({ ...input, markdownSkeleton: "x".repeat(500_001) }))
         .resolves.toEqual({ success: false, error: "CV template is too large" });
      await expect(handler.execute({ ...input, css: "x".repeat(100_001) }))
         .resolves.toEqual({ success: false, error: "CV template is too large" });
   });
});

describe("SaveCvTemplate — override an existing local template", () => {
   it("writes the next immutable version and keeps the previous one readable", async () => {
      const local = makeTemplate({ id: "local-1", version: 3, name: "Old", builtIn: false, tags: ["local"] });
      const repo = new InMemoryCvTemplateRepo([local]);
      const handler = createSaveCvTemplateHandler(repo, options);

      const result = await handler.execute({ ...input, overrideId: "local-1" });
      const saved = (result as { data: CvTemplate }).data;
      expect(saved.id).toBe("local-1");
      expect(saved.version).toBe(4);
      expect(saved.name).toBe("My Layout");
      expect(saved.tags).toEqual(["local"]);
      expect(saved.createdAt).toBe(options.now());
      expect((await repo.get("local-1", 3))?.name).toBe("Old");
      expect((await repo.get("local-1"))?.version).toBe(4);
   });

   it("rejects an unknown override target with a 404-mapped message", async () => {
      const handler = createSaveCvTemplateHandler(new InMemoryCvTemplateRepo(), options);
      await expect(handler.execute({ ...input, overrideId: "ghost" }))
         .resolves.toEqual({ success: false, error: "CV template not found" });
   });

   it("refuses to override built-in or public templates", async () => {
      const repo = new InMemoryCvTemplateRepo([
         makeTemplate({ id: "harvard", builtIn: true, tags: ["public"] }),
         makeTemplate({ id: "shared", builtIn: false, tags: ["public"] }),
      ]);
      const handler = createSaveCvTemplateHandler(repo, options);
      const message = "Built-in or public CV templates cannot be overridden";
      await expect(handler.execute({ ...input, overrideId: "harvard" })).resolves.toEqual({ success: false, error: message });
      await expect(handler.execute({ ...input, overrideId: "shared" })).resolves.toEqual({ success: false, error: message });
   });
});

describe("CloneCvTemplate", () => {
   it("clones a built-in template into an immutable local version 1", async () => {
      const repo = new InMemoryCvTemplateRepo([makeTemplate()]);
      const handler = createCloneCvTemplateHandler(repo);
      const clone = (await handler.execute({ id: "harvard", newId: "my-harvard" }) as { data: CvTemplate }).data;
      expect(clone.version).toBe(1);
      expect(clone.builtIn).toBe(false);
      expect(clone.tags).toEqual(["local"]);
      expect(clone.name).toBe("Harvard (Local)");
   });

   it("rejects invalid ids and missing sources", async () => {
      const repo = new InMemoryCvTemplateRepo([makeTemplate()]);
      const handler = createCloneCvTemplateHandler(repo);
      await expect(handler.execute({ id: "harvard", newId: "bad id!" }))
         .resolves.toEqual({ success: false, error: "Invalid CV template id" });
      await expect(handler.execute({ id: "ghost", newId: "ok" }))
         .resolves.toEqual({ success: false, error: "CV template not found" });
   });

   it("clones an explicitly requested version", async () => {
      const repo = new InMemoryCvTemplateRepo([makeTemplate({ version: 1, name: "V1" }), makeTemplate({ version: 2, name: "V2" })]);
      const handler = createCloneCvTemplateHandler(repo);
      const clone = (await handler.execute({ id: "harvard", version: 1, newId: "pinned" }) as { data: CvTemplate }).data;
      expect(clone.name).toBe("V1 (Local)");
   });
});
