import { createHandler, useMediator } from "../cqrs";
import {
   normalizeUserPreferences,
   parseUserPreferencesPatch,
   projectUserPreferences,
   type UserPreferencesView,
} from "../domain/preferences/preferences";
import type { UserPreferencesRepository } from "../repos/user-preferences.repo";

export interface SetUserPreferencesInput {
   userId: string;
   preferences: unknown;
}

export interface UserPreferencesHandlerDependencies {
   now(): Date;
}

const defaults: UserPreferencesHandlerDependencies = { now: () => new Date() };

/** Merge a validated partial update into the owner's stored preferences. */
export function createSetUserPreferencesHandler(
   repo: UserPreferencesRepository,
   dependencies: UserPreferencesHandlerDependencies = defaults,
) {
   return createHandler<SetUserPreferencesInput, UserPreferencesView>(
      "SetUserPreferences",
      async ({ userId, preferences }) => {
         if (!userId?.trim()) return { success: false, error: "User id is required" };
         const parsed = parseUserPreferencesPatch(preferences);
         if (!parsed.ok) return { success: false, error: parsed.error };

         const current = await repo.get(userId);
         const record = {
            ownerId: userId,
            preferences: normalizeUserPreferences({ ...current?.preferences, ...parsed.patch }),
            updatedAt: dependencies.now().toISOString(),
         };
         await repo.save(record);
         return { success: true, data: projectUserPreferences(record) };
      },
   );
}

export function setUserPreferencesCommand(input: SetUserPreferencesInput) {
   return { _type: "command" as const, requestName: "SetUserPreferences", payload: input };
}

export function registerSetUserPreferences(repo: UserPreferencesRepository) {
   useMediator().registerCommand(createSetUserPreferencesHandler(repo));
}
