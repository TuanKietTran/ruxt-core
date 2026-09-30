import { createHandler, useMediator } from "../cqrs";
import type { CvDocumentRecord } from "../repos/cv-document.repo";
import { parseCvProfileInput } from "./compose-cv-profile";
import { switchCvProfileCommand, type SwitchCvProfileInput, type SwitchCvProfileOutput } from "./switch-cv-profile";

/** Upper bound on sessions updated by one request. */
export const MAX_CV_PROFILE_APPLY_TARGETS = 50;

export interface ApplyCvProfileInput extends Omit<SwitchCvProfileInput, "documentId" | "expectedRevision"> {
   documentIds: string[];
}

export type ApplyCvProfileResult =
   | { documentId: string; ok: true; document: CvDocumentRecord }
   | { documentId: string; ok: false; error: string };

export interface ApplyCvProfileOutput {
   results: ApplyCvProfileResult[];
   applied: number;
   failed: number;
}

interface MediatorLike {
   send<T = unknown>(request: unknown): Promise<T>;
}

export function applyCvProfileCommand(input: ApplyCvProfileInput) {
   return { _type: "command" as const, requestName: "ApplyCvProfile", payload: input };
}

/**
 * Apply one profile to several sessions. Each session is its own
 * `SwitchCvProfile` saga, so one failure (a conflict, a missing session) is
 * reported for that session and never rolls back the others.
 */
export function createApplyCvProfileHandler(deps: { mediator?: MediatorLike } = {}) {
   const mediator = () => deps.mediator ?? useMediator();
   return createHandler<ApplyCvProfileInput, ApplyCvProfileOutput>("ApplyCvProfile", async (input) => {
      const documentIds = [...new Set((Array.isArray(input?.documentIds) ? input.documentIds : [])
         .filter((id): id is string => typeof id === "string" && Boolean(id.trim())))];
      if (!documentIds.length) throw new Error("documentIds is required");
      if (documentIds.length > MAX_CV_PROFILE_APPLY_TARGETS) throw new Error(`documentIds must list at most ${MAX_CV_PROFILE_APPLY_TARGETS} sessions`);
      // Reject a malformed profile once, before any session is touched.
      const profile = parseCvProfileInput(input.profile);

      const { documentIds: _ids, ...shared } = input;
      const results: ApplyCvProfileResult[] = [];
      for (const documentId of documentIds) {
         try {
            const output = await mediator().send<SwitchCvProfileOutput>(switchCvProfileCommand({ ...shared, profile, documentId }));
            results.push({ documentId, ok: true, document: output.document });
         } catch (error: any) {
            results.push({ documentId, ok: false, error: error?.message ?? "Profile switch failed" });
         }
      }
      const applied = results.filter(result => result.ok).length;
      return { success: true, data: { results, applied, failed: results.length - applied } };
   });
}

export function registerApplyCvProfile(deps: Parameters<typeof createApplyCvProfileHandler>[0] = {}) {
   useMediator().registerCommand(createApplyCvProfileHandler(deps));
}
