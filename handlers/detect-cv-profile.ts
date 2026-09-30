import { createHandler, useMediator } from "../cqrs";
import { detectCvProfile, type CvProfileDetection } from "../domain/cv/detect";
import type { CvDocumentPort } from "../repos/cv-document.repo";

export interface DetectCvProfileInput {
   documentId: string;
}

export interface DetectCvProfileOutput extends CvProfileDetection {
   documentId: string;
   /** Session revision the detection was read from. */
   revision: number;
}

export function detectCvProfileQuery(input: DetectCvProfileInput) {
   return { _type: "query" as const, requestName: "DetectCvProfile", payload: input };
}

/** Read a session and report the profile values it contains and where they appear. */
export function createDetectCvProfileHandler(documents: CvDocumentPort) {
   return createHandler<DetectCvProfileInput, DetectCvProfileOutput>("DetectCvProfile", async ({ documentId }) => {
      if (!documentId) throw new Error("documentId is required");
      const document = await documents.getCvDocument(documentId);
      return { success: true, data: { documentId: document.id, revision: document.revision, ...detectCvProfile(document.markdown) } };
   });
}

export function registerDetectCvProfile(documents: CvDocumentPort) {
   useMediator().registerQuery(createDetectCvProfileHandler(documents));
}
