import { describe, expect, it } from "vitest";
import { createExtractCvHandler, type CvExtractionResult, type CvExtractor } from "../handlers/extract-cv";
import { createGetCvCapabilitiesHandler } from "../handlers/get-cv-capabilities";

const accepted: CvExtractionResult = {
   accepted: true, concept: {}, markdown: "# CV", css: "", html: "<h1>CV</h1>", rawText: "CV", warnings: [],
};

function fakeExtractor(): CvExtractor & { calls: string[] } {
   const calls: string[] = [];
   return {
      calls,
      async capabilities() { return { available: true } as never; },
      async extract({ filename }) { calls.push(filename); return accepted; },
   };
}

const input = (bytes: Uint8Array) => ({
   bytes, filename: "cv.pdf", signal: new AbortController().signal, onProgress: async () => {},
});

describe("CV extraction handlers", () => {
   it("delegates extraction and capabilities to the application extractor", async () => {
      const extractor = fakeExtractor();
      await expect(createExtractCvHandler(extractor).execute(input(new Uint8Array([1])))).resolves.toEqual({ success: true, data: accepted });
      await expect(createGetCvCapabilitiesHandler(extractor).execute(undefined)).resolves.toEqual({ success: true, data: { available: true } });
      expect(extractor.calls).toEqual(["cv.pdf"]);
   });

   it("rejects empty sources before reaching the extractor", async () => {
      const extractor = fakeExtractor();
      await expect(createExtractCvHandler(extractor).execute(input(new Uint8Array()))).resolves.toEqual({
         success: false, error: "CV extraction requires a non-empty source",
      });
      expect(extractor.calls).toEqual([]);
   });
});
