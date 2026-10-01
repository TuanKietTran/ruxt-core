import { createHandler, useMediator } from "../cqrs";
import { CvConcept, CvProfile } from "../domain/cv/concept";
import { CvApplication } from "../domain/cv/application";
import type { CvDocumentPort, CvDocumentRecord } from "../repos/cv-document.repo";
import type { CvApplicationRepository } from "../repos/cv-application.repo";
import type { CvArtifactRepository, CvImportRepository } from "../repos/cv-import.repo";
import type { CvTemplateRepository } from "../repos/cv-template.repo";
import { requireCvImport } from "./get-cv-import";
import { readCvArtifactText } from "./preview-cv-import";

export interface CommitCvImportInput { id: string; ownerId: string; documentId: string }
export interface CommitCvImportOutput { application: CvApplication; document: CvDocumentRecord }

export function commitCvImportCommand(input: CommitCvImportInput) {
   return { _type: "command" as const, requestName: "CommitCvImport", payload: input };
}

export function createCommitCvImportHandler(deps: {
   imports: CvImportRepository;
   artifacts: CvArtifactRepository;
   documents: CvDocumentPort;
   applications: CvApplicationRepository;
   templates: CvTemplateRepository;
}) {
   return createHandler<CommitCvImportInput, CommitCvImportOutput>("CommitCvImport", async ({ id, ownerId, documentId }) => {
      const job = await requireCvImport(deps.imports, id, ownerId);
      if (job.state !== "succeeded") throw new Error("CV import must succeed before commit");
      const [markdown, css, conceptJson, template] = await Promise.all([
         readCvArtifactText(deps.artifacts, job, "markdown"), readCvArtifactText(deps.artifacts, job, "css"),
         readCvArtifactText(deps.artifacts, job, "concept"), deps.templates.get(job.template.id, job.template.version),
      ]);
      if (!template) throw new Error("CV template not found");
      const concept = CvConcept.create(JSON.parse(conceptJson));
      const document = await deps.documents.createCvDocument(documentId, { markdown, css, sourceId: `import:${id}` });
      const now = new Date().toISOString();
      const application = CvApplication.create({
         id: documentId, ownerId, revision: 1, status: "draft", createdAt: now, updatedAt: now,
         template: { ref: job.template, value: template },
         profile: { ref: { id: `${id}:profile`, version: concept.profile.version }, value: CvProfile.create(concept.profile) },
      });
      try {
         await deps.applications.create(application);
      } catch (error) {
         await deps.documents.removeCvDocument(document.id);
         throw error;
      }
      return { success: true, data: { application, document } };
   });
}

export function registerCommitCvImport(deps: Parameters<typeof createCommitCvImportHandler>[0]) {
   useMediator().registerCommand(createCommitCvImportHandler(deps));
}
