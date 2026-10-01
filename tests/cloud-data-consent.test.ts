import { describe, expect, it } from "vitest";
import {
   CLOUD_DATA_POLICY_VERSION,
   projectCloudDataConsent,
   type CloudConsentCategoryState,
   type CloudConsentEvent,
} from "../domain/cloud-data/consent";
import { createGetCloudDataConsentHandler } from "../handlers/get-cloud-data-consent";
import { createSetCloudDataConsentHandler } from "../handlers/set-cloud-data-consent";
import type { CloudConsentRepository } from "../repos/cloud-consent.repo";

class InMemoryCloudConsentRepo implements CloudConsentRepository {
   readonly current = new Map<string, CloudConsentCategoryState>();
   readonly events: CloudConsentEvent[] = [];

   async listCurrent(ownerId: string) {
      return [...this.current.values()].filter(state => state.ownerId === ownerId);
   }

   async saveChange(state: CloudConsentCategoryState, event: CloudConsentEvent) {
      this.current.set(`${state.ownerId}:${state.category}`, structuredClone(state));
      this.events.push(structuredClone(event));
   }

   async listEvents(ownerId: string) {
      return this.events.filter(event => event.ownerId === ownerId);
   }
}

const execute = async <I, O>(handler: { execute(input: I): Promise<{ success: true; data: O } | { success: false; error: string }> }, input: I) => handler.execute(input);

describe("cloud data consent", () => {
   it("defaults both optional categories to denied without persisting an implicit grant", async () => {
      const repo = new InMemoryCloudConsentRepo();
      const result = await execute(createGetCloudDataConsentHandler(repo), { userId: "user-1" });

      expect(result).toEqual({
         success: true,
         data: {
            policyVersion: CLOUD_DATA_POLICY_VERSION,
            cloudSessions: { granted: false, changedAt: null },
            cloudTemplates: { granted: false, changedAt: null },
         },
      });
      expect(repo.events).toHaveLength(0);
   });

   it("grants categories independently and records an append-only audit event", async () => {
      const repo = new InMemoryCloudConsentRepo();
      const handler = createSetCloudDataConsentHandler(repo, {
         now: () => new Date("2026-09-20T12:00:00.000Z"),
         newId: () => "event-1",
      });

      const result = await execute(handler, { userId: "user-1", category: "cloudTemplates", granted: true });

      expect(result).toMatchObject({
         success: true,
         data: {
            cloudSessions: { granted: false, changedAt: null },
            cloudTemplates: { granted: true, changedAt: "2026-09-20T12:00:00.000Z" },
         },
      });
      expect(repo.events).toEqual([{
         id: "event-1",
         ownerId: "user-1",
         actorUserId: "user-1",
         category: "cloudTemplates",
         granted: true,
         policyVersion: CLOUD_DATA_POLICY_VERSION,
         changedAt: "2026-09-20T12:00:00.000Z",
      }]);
   });

   it("records revocation without changing the other category", async () => {
      const repo = new InMemoryCloudConsentRepo();
      let tick = 0;
      const handler = createSetCloudDataConsentHandler(repo, {
         now: () => new Date(`2026-09-2${tick++}T12:00:00.000Z`),
         newId: () => `event-${tick}`,
      });

      await execute(handler, { userId: "user-1", category: "cloudSessions", granted: true });
      await execute(handler, { userId: "user-1", category: "cloudTemplates", granted: true });
      const result = await execute(handler, { userId: "user-1", category: "cloudSessions", granted: false });

      expect(result).toMatchObject({
         success: true,
         data: {
            cloudSessions: { granted: false },
            cloudTemplates: { granted: true },
         },
      });
      expect(repo.events).toHaveLength(3);
   });

   it("denies grants recorded against an obsolete policy until renewed", () => {
      expect(projectCloudDataConsent([{
         ownerId: "user-1",
         category: "cloudSessions",
         granted: true,
         policyVersion: "obsolete",
         changedAt: "2026-01-01T00:00:00.000Z",
      }])).toMatchObject({ cloudSessions: { granted: false } });
   });

   it.each([
      [{ userId: "", category: "cloudSessions", granted: true }, "User id is required"],
      [{ userId: "user-1", category: "other", granted: true }, "Invalid cloud data category"],
      [{ userId: "user-1", category: "cloudSessions", granted: "yes" }, "Granted must be a boolean"],
   ])("rejects invalid mutations", async (input, error) => {
      const repo = new InMemoryCloudConsentRepo();
      const result = await execute(createSetCloudDataConsentHandler(repo), input as never);
      expect(result).toEqual({ success: false, error });
      expect(repo.events).toHaveLength(0);
   });
});
