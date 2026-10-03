import { createHandler, useMediator } from "../cqrs";
import { projectUserPreferences, type UserPreferencesView } from "../domain/preferences/preferences";
import type { UserPreferencesRepository } from "../repos/user-preferences.repo";

export interface GetUserPreferencesInput {
   userId: string;
}

export function createGetUserPreferencesHandler(repo: UserPreferencesRepository) {
   return createHandler<GetUserPreferencesInput, UserPreferencesView>(
      "GetUserPreferences",
      async ({ userId }) => {
         if (!userId?.trim()) return { success: false, error: "User id is required" };
         return { success: true, data: projectUserPreferences(await repo.get(userId)) };
      },
   );
}

export function getUserPreferencesQuery(input: GetUserPreferencesInput) {
   return { _type: "query" as const, requestName: "GetUserPreferences", payload: input };
}

export function registerGetUserPreferences(repo: UserPreferencesRepository) {
   useMediator().registerQuery(createGetUserPreferencesHandler(repo));
}
