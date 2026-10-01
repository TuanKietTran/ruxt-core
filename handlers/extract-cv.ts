import { createHandler, useMediator } from "../cqrs";
import type { CvPipelineCapabilities } from "../domain/cv/import";

export interface CvExtractionResult {
   accepted: boolean;
   concept: unknown;
   markdown: string;
   css: string;
   html: string;
   rawText: string;
   confidence?: number;
   warnings: string[];
   rejection?: {
      code: "EMPTY_OR_UNREADABLE" | "NOT_CV_ALIKE";
      message: string;
      reasons?: string[];
   };
}

export interface ExtractCvInput {
   bytes: Uint8Array;
   filename: string;
   signal: AbortSignal;
   onProgress: (progress: number, stage: string) => Promise<void>;
}

/** Extraction backend implemented by the application (for example the Python pipeline adapter). */
export interface CvExtractor {
   capabilities(): Promise<CvPipelineCapabilities>;
   extract(input: ExtractCvInput): Promise<CvExtractionResult>;
}

export function extractCvCommand(input: ExtractCvInput) {
   return { _type: "command" as const, requestName: "ExtractCv", payload: input };
}

export function createExtractCvHandler(extractor: CvExtractor) {
   return createHandler<ExtractCvInput, CvExtractionResult>("ExtractCv", async (input) => {
      if (!input.bytes.byteLength) throw new Error("CV extraction requires a non-empty source");
      return { success: true, data: await extractor.extract(input) };
   });
}

export function registerExtractCv(extractor: CvExtractor) {
   useMediator().registerCommand(createExtractCvHandler(extractor));
}
