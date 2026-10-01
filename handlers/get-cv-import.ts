import { createHandler, useMediator } from "../cqrs";
import type { CvImportJob } from "../domain/cv/import";
import type { CvImportRepository } from "../repos/cv-import.repo";

export function getCvImportQuery(input: { id: string; ownerId: string }) {
   return { _type: "query" as const, requestName: "GetCvImport", payload: input };
}

export function createGetCvImportHandler(repo: CvImportRepository) {
   return createHandler<{ id: string; ownerId: string }, CvImportJob>("GetCvImport", async ({ id, ownerId }) => ({
      success: true, data: await requireCvImport(repo, id, ownerId),
   }));
}

export function registerGetCvImport(repo: CvImportRepository) {
   useMediator().registerQuery(createGetCvImportHandler(repo));
}

/** Owner-scoped lookup shared by the CV import handlers. */
export async function requireCvImport(repo: CvImportRepository, id: string, ownerId: string) {
   const job = await repo.get(id, ownerId);
   if (!job) throw new Error("CV import not found");
   return job;
}
