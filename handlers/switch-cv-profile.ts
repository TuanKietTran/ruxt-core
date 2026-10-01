import { createHandler, useMediator } from "../cqrs";
import type { CvApplication } from "../domain/cv/application";
import { CvRevisionConflict } from "../domain/cv/version";
import type { CvTemplateReference } from "../domain/cv/types";
import type { CvDocumentRecord } from "../repos/cv-document.repo";
import { runSaga, type SagaStep } from "../saga";
import { composeCvProfileQuery, type ComposeCvProfileOutput } from "./compose-cv-profile";
import { getCvDocumentQuery } from "./get-cv-document";
import { saveCvSourceCommand } from "./save-cv-source";
import { updateCvApplicationProfileCommand, type UpdateCvApplicationProfileOutput } from "./update-cv-application-profile";

export interface SwitchCvProfileInput {
   documentId: string;
   /** Untrusted profile payload (for example, a browser-local profile). */
   profile: unknown;
   /** Stable id of the chosen profile, recorded on the application snapshot. */
   profileId?: string;
   /** Switch layout too; omit to infer the skeleton from the current session. */
   template?: { id: string; version?: number };
   expectedRevision?: number;
   /** Owner whose CV application (if any) should track the new profile. */
   ownerId?: string;
   publicOnly?: boolean;
   sourceId?: string;
}

export interface SwitchCvProfileOutput {
   document: CvDocumentRecord;
   application: CvApplication | null;
   template?: CvTemplateReference;
}

interface SwitchContext {
   input: SwitchCvProfileInput;
   previous?: CvDocumentRecord;
   composed?: ComposeCvProfileOutput;
   document?: CvDocumentRecord;
   application: CvApplication | null;
}

interface MediatorLike {
   send<T = unknown>(request: unknown): Promise<T>;
}

export function switchCvProfileCommand(input: SwitchCvProfileInput) {
   return { _type: "command" as const, requestName: "SwitchCvProfile", payload: input };
}

/**
 * Saga across two stores that cannot share a transaction:
 * 1. compose   — read the session and render the profile (no side effects);
 * 2. document  — `SaveCvSource` under the read revision; compensated by writing
 *                the previous source back under the new revision;
 * 3. application — `UpdateCvApplicationProfile` re-snapshots the profile (and
 *                template) on the owner's CV application, if one exists.
 * A compensation that meets a newer concurrent edit is skipped: the newer edit
 * wins and the failure is reported on the `SagaError`.
 */
export function createSwitchCvProfileHandler(deps: { mediator?: MediatorLike } = {}) {
   const mediator = () => deps.mediator ?? useMediator();

   const steps: SagaStep<SwitchContext>[] = [
      {
         name: "compose",
         async run(context) {
            const { input } = context;
            const previous = await mediator().send<CvDocumentRecord>(getCvDocumentQuery({ id: input.documentId }));
            if (input.expectedRevision !== undefined && input.expectedRevision !== previous.revision) {
               throw new CvRevisionConflict(input.expectedRevision, previous.revision);
            }
            context.previous = previous;
            context.composed = await mediator().send<ComposeCvProfileOutput>(composeCvProfileQuery({
               profile: input.profile,
               template: input.template,
               source: previous,
               publicOnly: input.publicOnly,
            }));
         },
      },
      {
         name: "document",
         async run(context) {
            const { input, previous, composed } = context;
            context.document = await mediator().send<CvDocumentRecord>(saveCvSourceCommand({
               id: input.documentId,
               markdown: composed!.markdown,
               css: composed!.css,
               expectedRevision: previous!.revision,
               sourceId: input.sourceId,
            }));
         },
         async compensate(context) {
            const { input, previous, document } = context;
            context.document = await mediator().send<CvDocumentRecord>(saveCvSourceCommand({
               id: input.documentId,
               markdown: previous!.markdown,
               css: previous!.css,
               expectedRevision: document!.revision,
               sourceId: input.sourceId ? `${input.sourceId}:compensate` : "switch-cv-profile:compensate",
            }));
         },
      },
      {
         name: "application",
         async run(context) {
            const { input, composed } = context;
            if (!input.ownerId) return;
            context.application = await mediator().send<UpdateCvApplicationProfileOutput>(updateCvApplicationProfileCommand({
               id: input.documentId,
               ownerId: input.ownerId,
               profile: composed!.profile,
               profileId: input.profileId,
               template: composed!.template,
            }));
         },
      },
   ];

   return createHandler<SwitchCvProfileInput, SwitchCvProfileOutput>("SwitchCvProfile", async (input) => {
      if (!input?.documentId) throw new Error("documentId is required");
      const context = await runSaga("SwitchCvProfile", steps, { input, application: null });
      return {
         success: true,
         data: { document: context.document!, application: context.application, template: context.composed!.template },
      };
   });
}

export function registerSwitchCvProfile(deps: Parameters<typeof createSwitchCvProfileHandler>[0] = {}) {
   useMediator().registerCommand(createSwitchCvProfileHandler(deps));
}
