/** How the profile editor stores a field once it is being edited. */
export const PROFILE_SAVE_MODES = ["auto", "manual"] as const;
export type ProfileSaveMode = (typeof PROFILE_SAVE_MODES)[number];

/** Per-user editor settings. Settings, not CV data: they carry no profile or session content. */
export interface UserPreferences {
   profileSaveMode: ProfileSaveMode;
}

export interface UserPreferencesRecord {
   ownerId: string;
   preferences: UserPreferences;
   updatedAt: string;
}

export interface UserPreferencesView {
   preferences: UserPreferences;
   updatedAt: string | null;
}

export const DEFAULT_USER_PREFERENCES: Readonly<UserPreferences> = Object.freeze({ profileSaveMode: "auto" });

export function isProfileSaveMode(value: unknown): value is ProfileSaveMode {
   return typeof value === "string" && PROFILE_SAVE_MODES.includes(value as ProfileSaveMode);
}

/** Fill missing or unknown values with defaults so stored records survive new settings. */
export function normalizeUserPreferences(raw: unknown): UserPreferences {
   const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
   return {
      profileSaveMode: isProfileSaveMode(value.profileSaveMode) ? value.profileSaveMode : DEFAULT_USER_PREFERENCES.profileSaveMode,
   };
}

/** Validate a partial update; unknown keys and invalid values are rejected rather than dropped. */
export function parseUserPreferencesPatch(raw: unknown): { ok: true; patch: Partial<UserPreferences> } | { ok: false; error: string } {
   if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Preferences must be an object" };
   const patch: Partial<UserPreferences> = {};
   for (const [key, value] of Object.entries(raw)) {
      if (key !== "profileSaveMode") return { ok: false, error: `Unknown preference: ${key}` };
      if (!isProfileSaveMode(value)) return { ok: false, error: "Invalid profile save mode" };
      patch.profileSaveMode = value;
   }
   if (!Object.keys(patch).length) return { ok: false, error: "Preferences must not be empty" };
   return { ok: true, patch };
}

export function projectUserPreferences(record: UserPreferencesRecord | null): UserPreferencesView {
   return {
      preferences: normalizeUserPreferences(record?.preferences),
      updatedAt: record?.updatedAt ?? null,
   };
}
