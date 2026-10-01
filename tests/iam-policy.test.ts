import { describe, expect, it } from "vitest";
import {
   OwnerFullAccessPolicy,
   PolicyEvaluator,
   SameOrgPolicy,
   ServiceAccountReadOnlyPolicy,
} from "../domain/iam/policy";
import { AccessRequest } from "../domain/iam/access-request";
import { SubjectAttributes } from "../domain/iam/subject-attributes";
import { ResourceAttributes } from "../domain/iam/resource-attributes";
import { Action } from "../domain/iam/action";
import type { ActionCode } from "../domain/iam/types";

const evaluator = new PolicyEvaluator([OwnerFullAccessPolicy, ServiceAccountReadOnlyPolicy, SameOrgPolicy]);

const request = (
   subject: Parameters<typeof SubjectAttributes.of>[0],
   action: ActionCode,
   resource: Partial<Parameters<typeof ResourceAttributes.of>[0]> = {},
) => AccessRequest.of(
   SubjectAttributes.of(subject),
   ResourceAttributes.of({ resourceType: "subscription", resourceId: "sub_1", ownerUserId: "user_1", ...resource }),
   Action.of(action),
);

describe("attribute value objects", () => {
   it("require non-empty identifiers", () => {
      expect(() => SubjectAttributes.of({ userId: " ", tier: "free" })).toThrow("userId must not be empty");
      expect(() => ResourceAttributes.of({ resourceType: "plan", resourceId: "" })).toThrow("resourceId must not be empty");
   });

   it("default optional attributes conservatively", () => {
      expect(SubjectAttributes.of({ userId: "user_1", tier: "free" }).toJSON())
         .toEqual({ userId: "user_1", orgId: null, tier: "free", isOwner: false, isServiceAccount: false });
   });
});

describe("PolicyEvaluator", () => {
   it("denies by default when every policy abstains", () => {
      const decision = evaluator.evaluate(request({ userId: "stranger", tier: "free" }, "subscription:read"));
      expect(decision.isAllowed()).toBe(false);
      expect(decision.reason).toBe("No policy allowed the request (default-deny)");
   });

   it("allows an owner full access to their own resource", () => {
      expect(evaluator.evaluate(request({ userId: "user_1", tier: "free", isOwner: true }, "subscription:cancel")).isAllowed()).toBe(true);
   });

   it("does not extend ownership to other people's resources", () => {
      const decision = evaluator.evaluate(
         request({ userId: "user_1", tier: "pro", isOwner: true }, "subscription:write", { ownerUserId: "user_2" }),
      );
      expect(decision.isAllowed()).toBe(false);
   });

   it("keeps service accounts read-only", () => {
      const subject = { userId: "svc", tier: "enterprise" as const, isServiceAccount: true };
      expect(evaluator.evaluate(request(subject, "subscription:read")).isAllowed()).toBe(true);
      const denied = evaluator.evaluate(request(subject, "subscription:write"));
      expect(denied.isAllowed()).toBe(false);
      expect(denied.reason).toContain("[ServiceAccountReadOnlyPolicy]");
   });

   it("lets a deny from one policy override an allow from another", () => {
      const decision = evaluator.evaluate(
         request({ userId: "user_1", tier: "pro", isOwner: true, isServiceAccount: true }, "subscription:cancel"),
      );
      expect(decision.isAllowed()).toBe(false);
   });

   it("grants same-org members read access only", () => {
      const subject = { userId: "colleague", tier: "pro" as const, orgId: "org_1" };
      const resource = { ownerUserId: "user_1", ownerOrgId: "org_1" };
      expect(evaluator.evaluate(request(subject, "subscription:read", resource)).isAllowed()).toBe(true);
      expect(evaluator.evaluate(request(subject, "subscription:write", resource)).isAllowed()).toBe(false);
   });

   it("does not leak across organisations", () => {
      const decision = evaluator.evaluate(
         request({ userId: "outsider", tier: "pro", orgId: "org_2" }, "subscription:read", { ownerOrgId: "org_1" }),
      );
      expect(decision.isAllowed()).toBe(false);
   });
});
