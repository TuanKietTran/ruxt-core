import type { UserPreferencesRecord } from "../domain/preferences/preferences";

/** Owner-keyed preference store. */
export interface UserPreferencesRepository {
   get(ownerId: string): Promise<UserPreferencesRecord | null>;
   save(record: UserPreferencesRecord): Promise<void>;
}
