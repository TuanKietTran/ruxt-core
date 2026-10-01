import { createHandler, useMediator } from "../cqrs";
import { CvImportJob } from "../domain/cv/import";
import type { CvImportRepository } from "../repos/cv-import.repo";
import { requireCvImport } from "./get-cv-import";

export function cancelCvImportCommand(input: { id: string; ownerId: string }) {
   return { _type: "command" as const, requestName: "CancelCvImport", payload: input };
}

export function createCancelCvImportHandler(repo: CvImportRepository) {
   return createHandler<{ id: string; ownerId: string }, CvImportJob>("CancelCvImport", async ({ id, ownerId }) => {
      const job = await requireCvImport(repo, id, ownerId);
      if (["succeeded", "failed", "cancelled"].includes(job.state)) throw new Error("CV import cannot be cancelled in its current state");
      const updated = CvImportJob.create({ ...job.toJSON(), cancelRequested: true, stage: "cancelling", updatedAt: new Date().toISOString() });
      await repo.save(updated);
      return { success: true, data: updated };
   });
}

export function registerCancelCvImport(repo: CvImportRepository) {
   useMediator().registerCommand(createCancelCvImportHandler(repo));
}
