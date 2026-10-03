import { describe, expect, it } from "vitest";
import { normalizeUserPreferences, type UserPreferencesRecord } from "../domain/preferences/preferences";
import { createGetUserPreferencesHandler } from "../handlers/get-user-preferences";
import { createSetUserPreferencesHandler } from "../handlers/set-user-preferences";
import type { UserPreferencesRepository } from "../repos/user-preferences.repo";

class InMemoryUserPreferencesRepo implements UserPreferencesRepository {
   readonly records = new Map<string, UserPreferencesRecord>();
   async get(ownerId: string) { return structuredClone(this.records.get(ownerId) ?? null); }
   async save(record: UserPreferencesRecord) { this.records.set(record.ownerId, structuredClone(record)); }
}

const now = () => new Date("2026-10-03T09:00:00.000Z");

describe("user preferences", () => {
   it("defaults to auto-saving profile fields without persisting anything", async () => {
      const repo = new InMemoryUserPreferencesRepo();
      const result = await createGetUserPreferencesHandler(repo).execute({ userId: "user-1" });
      expect(result).toEqual({ success: true, data: { preferences: { profileSaveMode: "auto" }, updatedAt: null } });
      expect(repo.records.size).toBe(0);
   });

   it("stores a valid update per owner", async () => {
      const repo = new InMemoryUserPreferencesRepo();
      const set = createSetUserPreferencesHandler(repo, { now });
      const result = await set.execute({ userId: "user-1", preferences: { profileSaveMode: "manual" } });
      expect(result).toEqual({ success: true, data: { preferences: { profileSaveMode: "manual" }, updatedAt: "2026-10-03T09:00:00.000Z" } });

      const get = createGetUserPreferencesHandler(repo);
      expect(await get.execute({ userId: "user-1" })).toMatchObject({ data: { preferences: { profileSaveMode: "manual" } } });
      expect(await get.execute({ userId: "user-2" })).toMatchObject({ data: { preferences: { profileSaveMode: "auto" } } });
   });

   it("rejects unknown keys, invalid values and empty updates", async () => {
      const set = createSetUserPreferencesHandler(new InMemoryUserPreferencesRepo(), { now });
      expect(await set.execute({ userId: "user-1", preferences: { profileSaveMode: "sometimes" } })).toEqual({ success: false, error: "Invalid profile save mode" });
      expect(await set.execute({ userId: "user-1", preferences: { theme: "dark" } })).toEqual({ success: false, error: "Unknown preference: theme" });
      expect(await set.execute({ userId: "user-1", preferences: {} })).toEqual({ success: false, error: "Preferences must not be empty" });
      expect(await set.execute({ userId: "user-1", preferences: null })).toEqual({ success: false, error: "Preferences must be an object" });
      expect(await set.execute({ userId: " ", preferences: { profileSaveMode: "auto" } })).toEqual({ success: false, error: "User id is required" });
   });

   it("normalizes stored records with missing or unknown values to defaults", () => {
      expect(normalizeUserPreferences(undefined)).toEqual({ profileSaveMode: "auto" });
      expect(normalizeUserPreferences({ profileSaveMode: "bogus", extra: 1 })).toEqual({ profileSaveMode: "auto" });
   });
});
