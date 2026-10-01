import { createHandler, useMediator } from "../cqrs";
import type { CvPipelineCapabilities } from "../domain/cv/import";
import type { CvExtractor } from "./extract-cv";

export function getCvCapabilitiesQuery() {
   return { _type: "query" as const, requestName: "GetCvCapabilities", payload: undefined };
}

export function createGetCvCapabilitiesHandler(extractor: CvExtractor) {
   return createHandler<void, CvPipelineCapabilities>("GetCvCapabilities", async () => ({
      success: true, data: await extractor.capabilities(),
   }));
}

export function registerGetCvCapabilities(extractor: CvExtractor) {
   useMediator().registerQuery(createGetCvCapabilitiesHandler(extractor));
}
