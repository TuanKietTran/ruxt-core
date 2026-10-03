import { describe, expect, it } from "vitest";
import {
   cvSessionsToRecover,
   cvTitleFromMarkdown,
   isCvRouteId,
   mergeCvSessions,
   parseCvSessionBackup,
   shouldRestoreCvBackup,
   type CvSessionBackupEntry,
} from "../domain/cv/session-backup";

const server = { markdown: "# Ada\n\nSaved", css: ".cv {}", revision: 4 };
const backup = (overrides: Partial<CvSessionBackupEntry> = {}) =>
   ({ markdown: "# Ada\n\nSaved", css: ".cv {}", revision: 4, pending: false, ...overrides });

const idA = "0b6f3c2e-1d4a-4e8b-9c7d-2a1b3c4d5e6f";
const idB = "9f8e7d6c5b4a39281706f5e4d3c2b1a0";

describe("shouldRestoreCvBackup", () => {
   it("keeps the server copy when there is nothing newer locally", () => {
      expect(shouldRestoreCvBackup(null, server)).toBe(false);
      expect(shouldRestoreCvBackup(backup(), server)).toBe(false);
      expect(shouldRestoreCvBackup(backup({ markdown: "# Ada\n\nOld", revision: 3 }), server)).toBe(false);
   });

   it("restores when the server lost the session or is behind", () => {
      expect(shouldRestoreCvBackup(backup(), null)).toBe(true);
      expect(shouldRestoreCvBackup(backup({ revision: 9 }), { markdown: "# cv", css: "", revision: 1 })).toBe(true);
   });

   it("restores an unacknowledged edit on the current revision, never over a newer one", () => {
      expect(shouldRestoreCvBackup(backup({ markdown: "# Ada\n\nEdited", pending: true }), server)).toBe(true);
      expect(shouldRestoreCvBackup(backup({ pending: true }), server)).toBe(false);
      expect(shouldRestoreCvBackup(backup({ markdown: "local", revision: 3, pending: true }), server)).toBe(false);
   });
});

describe("backup parsing and identity", () => {
   it("accepts complete backups, including ones stored before titles existed", () => {
      expect(parseCvSessionBackup({ markdown: "# Old", css: "", revision: 2 })).toEqual({ markdown: "# Old", css: "", revision: 2, pending: false, title: undefined, savedAt: undefined });
      expect(parseCvSessionBackup({ markdown: "# A", css: "", revision: 1, pending: 1, title: "A", savedAt: 5 })).toMatchObject({ pending: true, title: "A", savedAt: 5 });
   });

   it("rejects incomplete or malformed values", () => {
      for (const raw of [null, "x", {}, { markdown: "# A", css: "" }, { markdown: "# A", css: "", revision: 1.5 }, { markdown: 1, css: "", revision: 1 }]) {
         expect(parseCvSessionBackup(raw)).toBeNull();
      }
   });

   it("reads titles from the first heading and recognises editor route ids", () => {
      expect(cvTitleFromMarkdown("# Ada Lovelace {.cv-name}\n\nBody")).toBe("Ada Lovelace");
      expect(cvTitleFromMarkdown("No heading")).toBeUndefined();
      expect(isCvRouteId(idA)).toBe(true);
      expect(isCvRouteId(idB)).toBe(true);
      expect(isCvRouteId("master")).toBe(false);
   });
});

describe("recovering sessions a server lost", () => {
   const entries: CvSessionBackupEntry[] = [
      { id: idA, ...backup({ markdown: "# Ada", revision: 3, title: "Ada", savedAt: Date.parse("2026-10-02T00:00:00Z") }) },
      { id: idB, ...backup({ markdown: "# Grace", revision: 1 }) },
      { id: "master", ...backup({ markdown: "# Master" }) },
      { id: "11111111-2222-4333-8444-555555555555", ...backup({ markdown: "   " }) },
   ];
   const serverList = [{ id: idB, title: "Grace", revision: 5, updatedAt: "2026-10-01T00:00:00.000Z" }];

   it("re-creates only missing route-id sessions with content", () => {
      expect(cvSessionsToRecover(serverList, entries).map(entry => entry.id)).toEqual([idA]);
   });

   it("lists server sessions plus local-only ones, newest first", () => {
      expect(mergeCvSessions(serverList, entries)).toEqual([
         { id: idA, title: "Ada", revision: 3, updatedAt: "2026-10-02T00:00:00.000Z", localOnly: true },
         serverList[0],
      ]);
      expect(mergeCvSessions([], entries).map(session => session.id)).toEqual([idA, idB]);
   });
});
