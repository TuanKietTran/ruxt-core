import { createHandler, useMediator } from "../cqrs";
import type { CvImportJob, CvImportPreview } from "../domain/cv/import";
import type { CvArtifactRepository, CvImportRepository } from "../repos/cv-import.repo";
import { requireCvImport } from "./get-cv-import";

export function previewCvImportQuery(input: { id: string; ownerId: string }) {
   return { _type: "query" as const, requestName: "PreviewCvImport", payload: input };
}

export function createPreviewCvImportHandler(imports: CvImportRepository, artifacts: CvArtifactRepository) {
   return createHandler<{ id: string; ownerId: string }, CvImportPreview>("PreviewCvImport", async ({ id, ownerId }) => {
      const job = await requireCvImport(imports, id, ownerId);
      if (job.state !== "succeeded") throw new Error("CV import must succeed before preview");
      const [conceptJson, markdown, css] = await Promise.all([
         readCvArtifactText(artifacts, job, "concept"),
         readCvArtifactText(artifacts, job, "markdown"),
         readCvArtifactText(artifacts, job, "css"),
      ]);
      return { success: true, data: {
         importId: id, state: job.state, concept: JSON.parse(conceptJson), markdown, css,
         warnings: job.warnings,
      } };
   });
}

export function registerPreviewCvImport(imports: CvImportRepository, artifacts: CvArtifactRepository) {
   useMediator().registerQuery(createPreviewCvImportHandler(imports, artifacts));
}

/** Decode one generated text artifact of an owner's import job. */
export async function readCvArtifactText(
   artifacts: CvArtifactRepository,
   job: CvImportJob,
   kind: CvImportJob["artifacts"][number]["kind"],
): Promise<string> {
   const metadata = job.artifacts.find((item) => item.kind === kind);
   if (!metadata) throw new Error(`CV import ${kind} artifact not found`);
   const bytes = await artifacts.read(metadata.id, job.ownerId);
   if (!bytes) throw new Error(`CV import ${kind} artifact not found`);
   return new TextDecoder().decode(bytes);
}
