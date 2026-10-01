import { createHandler, useMediator } from "../cqrs";
import { CvImportJob } from "../domain/cv/import";
import type { CvImportRepository } from "../repos/cv-import.repo";
import { requireCvImport } from "./get-cv-import";

export function retryCvImportCommand(input: { id: string; ownerId: string }) {
   return { _type: "command" as const, requestName: "RetryCvImport", payload: input };
}

export function createRetryCvImportHandler(repo: CvImportRepository) {
   return createHandler<{ id: string; ownerId: string }, CvImportJob>("RetryCvImport", async ({ id, ownerId }) => {
      const job = await requireCvImport(repo, id, ownerId);
      if (!["failed", "cancelled"].includes(job.state)) throw new Error("CV import cannot be retried in its current state");
      const updated = CvImportJob.create({ ...job.toJSON(), state: "queued", progress: 0, stage: "queued", artifacts: [],
         warnings: [], error: undefined, cancelRequested: false, attempt: job.attempt + 1, updatedAt: new Date().toISOString() });
      await repo.save(updated);
      return { success: true, data: updated };
   });
}

export function registerRetryCvImport(repo: CvImportRepository) {
   useMediator().registerCommand(createRetryCvImportHandler(repo));
}
