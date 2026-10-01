import { describe, expect, it } from "vitest";
import { Email } from "../domain/email/email";
import { Instant } from "../domain/datetime/instant";
import { Duration } from "../domain/datetime/duration";
import { SocialDate } from "../domain/datetime/social";
import { Money } from "../domain/subscription/money";
import { BillingCycle } from "../domain/subscription/billing-cycle";
import { SubscriptionStatus } from "../domain/subscription/subscription-status";
import { Subscription } from "../domain/subscription/subscription";
import { Plan } from "../domain/catalog/plan";
import { PlanId } from "../domain/catalog/plan-id";
import { CardNumber } from "../domain/payment/card-number";

describe("Email", () => {
   it("normalizes case and surrounding whitespace", () => {
      expect(Email.create("  Ada@Example.COM ").value).toBe("ada@example.com");
   });

   it("rejects empty and malformed addresses", () => {
      expect(() => Email.create("   ")).toThrow("Empty email address");
      expect(() => Email.create("ada@example")).toThrow("Invalid email address");
      expect(() => Email.create("ada example.com")).toThrow("Invalid email address");
   });
});

describe("Instant", () => {
   it("requires an unambiguous ISO string", () => {
      expect(Instant.fromISO("2026-01-01T00:00:00Z").toISO()).toBe("2026-01-01T00:00:00.000Z");
      expect(() => Instant.fromISO("2026-01-01T00:00:00")).toThrow("ambiguous");
      expect(() => Instant.fromISO("not-a-date+00:00")).toThrow(/invalid iso/);
   });

   it("rejects non-integer epoch millis", () => {
      expect(() => Instant.fromEpochMillis(1.5)).toThrow("epochMillis must be finite integer");
   });

   it("compares and shifts without mutating", () => {
      const start = Instant.fromISO("2026-01-01T00:00:00Z");
      const later = start.plusDays(30);
      expect(start.isBefore(later)).toBe(true);
      expect(later.isAfter(start)).toBe(true);
      expect(start.millisUntil(later)).toBe(30 * 86_400_000);
      expect(start.toISO()).toBe("2026-01-01T00:00:00.000Z");
   });
});

describe("Duration", () => {
   it("converts between units and composes", () => {
      expect(Duration.fromDays(1).hours).toBe(24);
      expect(Duration.fromMinutes(30).add(Duration.fromMinutes(30)).hours).toBe(1);
      expect(Duration.fromHours(2).dividedBy(2).hours).toBe(1);
      expect(Duration.fromSeconds(5).negate().millis).toBe(-5000);
   });
});

describe("SocialDate", () => {
   it("clamps month-end arithmetic and handles leap years", () => {
      expect(SocialDate.of(2026, 1, 31).plusMonths(1).toISO()).toBe("2026-02-28");
      expect(SocialDate.of(2024, 1, 31).plusMonths(1).toISO()).toBe("2024-02-29");
      expect(SocialDate.of(2026, 1, 1).daysUntil(SocialDate.of(2027, 1, 1))).toBe(365);
   });
});

describe("Money", () => {
   it("respects per-currency minor units", () => {
      expect(Money.fromMajor(9.99, "USD").amountMinor).toBe(999);
      expect(Money.fromMajor(1000, "JPY").amountMinor).toBe(1000);
      expect(Money.of(999, "USD").toString()).toBe("9.99 USD");
      expect(Money.of(1000, "JPY").toString()).toBe("1000 JPY");
   });

   it("rejects negative or fractional minor amounts", () => {
      expect(() => Money.of(-1, "USD")).toThrow("non-negative integer");
      expect(() => Money.of(1.5, "USD")).toThrow("non-negative integer");
   });

   it("refuses cross-currency arithmetic", () => {
      expect(() => Money.of(100, "USD").add(Money.of(100, "EUR"))).toThrow("currency mismatch: USD vs EUR");
      expect(() => Money.of(100, "USD").isGreaterThan(Money.of(1, "EUR"))).toThrow("currency mismatch");
   });
});

describe("BillingCycle", () => {
   it("maps known periods to nominal durations", () => {
      expect(BillingCycle.of("monthly").duration.days).toBe(30);
      expect(BillingCycle.YEARLY.duration.days).toBe(365);
   });

   it("rejects unknown periods", () => {
      expect(() => BillingCycle.of("fortnightly" as never)).toThrow("unknown billing period: fortnightly");
   });
});

describe("SubscriptionStatus", () => {
   it("grants access while active or trialing only", () => {
      expect(SubscriptionStatus.ACTIVE.hasAccess).toBe(true);
      expect(SubscriptionStatus.TRIALING.hasAccess).toBe(true);
      expect(SubscriptionStatus.PAST_DUE.hasAccess).toBe(false);
      expect(SubscriptionStatus.PAUSED.hasAccess).toBe(false);
   });

   it("allows only declared transitions", () => {
      expect(SubscriptionStatus.ACTIVE.transitionTo("paused").code).toBe("paused");
      expect(SubscriptionStatus.PAUSED.transitionTo("active").code).toBe("active");
      expect(() => SubscriptionStatus.ACTIVE.transitionTo("trialing")).toThrow("invalid transition: active → trialing");
   });

   it("treats cancelled and expired as terminal", () => {
      expect(SubscriptionStatus.CANCELLED.isTerminal).toBe(true);
      expect(SubscriptionStatus.EXPIRED.isTerminal).toBe(true);
      expect(() => SubscriptionStatus.CANCELLED.transitionTo("active")).toThrow("invalid transition");
   });

   it("rejects unknown status codes", () => {
      expect(() => SubscriptionStatus.of("lapsed" as never)).toThrow("unknown status: lapsed");
   });
});

describe("Subscription", () => {
   const startAt = Instant.fromISO("2026-01-01T00:00:00Z");
   const periodEnd = startAt.plusDays(30);
   const create = (trialDuration?: Duration) =>
      Subscription.create({ id: "sub_1", userId: "user_1", planId: "plan_pro", startAt, periodEnd, trialDuration });

   it("starts active without a trial and trialing with one", () => {
      expect(create().status.code).toBe("active");
      const trialing = create(Duration.fromDays(14));
      expect(trialing.status.code).toBe("trialing");
      expect(trialing.trialEndsAt?.toISO()).toBe(startAt.plusDays(14).toISO());
      expect(trialing.isInTrial(startAt.plusDays(1))).toBe(true);
      expect(trialing.isInTrial(startAt.plusDays(20))).toBe(false);
   });

   it("requires a user id", () => {
      expect(() => Subscription.create({ id: "s", userId: "  ", planId: "p", startAt, periodEnd }))
         .toThrow("userId must not be empty");
   });

   it("transitions immutably and stamps the transition time", () => {
      const active = create();
      const paused = active.pause(startAt.plusDays(2));
      expect(active.status.code).toBe("active");
      expect(paused.pausedAt?.toISO()).toBe(startAt.plusDays(2).toISO());
      expect(paused.resume().pausedAt).toBeNull();
      expect(active.cancel(startAt).isAccessGranted()).toBe(false);
   });

   it("guards scheduled plan changes", () => {
      const active = create();
      expect(active.schedulePlanChange(PlanId.of("plan_max")).hasPendingPlanChange).toBe(true);
      expect(() => active.schedulePlanChange(PlanId.of("plan_pro"))).toThrow("must differ");
      expect(() => active.cancel(startAt).schedulePlanChange(PlanId.of("plan_max")))
         .toThrow("Cannot schedule plan change on a terminal subscription");
   });
});

describe("Plan", () => {
   const base = { id: "plan_pro", name: "Pro", description: " Everything ", price: Money.of(999, "USD"), billingCycle: BillingCycle.MONTHLY };

   it("applies defaults and trims free-text fields", () => {
      const plan = Plan.create({ ...base, features: [" export ", "", "mcp"] });
      expect(plan.toJSON()).toMatchObject({ source: "catalog", isPublic: true, createdBy: null, features: ["export", "mcp"] });
   });

   it("rejects empty and overlong names", () => {
      expect(() => Plan.create({ ...base, name: "   " })).toThrow("Plan name must not be empty");
      expect(() => Plan.create({ ...base, name: "n".repeat(101) })).toThrow("≤ 100 characters");
   });
});

describe("CardNumber", () => {
   it("normalizes separators and exposes only masked data", () => {
      const card = CardNumber.create("4242 4242 4242 4242");
      expect(card.brand).toBe("visa");
      expect(card.lastFour).toBe("4242");
      expect(card.toString()).toBe("****4242");
      expect(card.toJSON()).toEqual({ brand: "visa", lastFour: "4242" });
      expect(JSON.stringify(card)).not.toContain("4242424242424242");
   });

   it("detects brands from the issuer prefix", () => {
      expect(CardNumber.create("5555555555554444").brand).toBe("mastercard");
      expect(CardNumber.create("378282246310005").brand).toBe("american-express");
      expect(CardNumber.create("6011111111111117").brand).toBe("discover");
   });

   it("rejects numbers failing the Luhn check", () => {
      expect(() => CardNumber.create("4242424242424241")).toThrow();
      expect(() => CardNumber.create("abcd")).toThrow();
   });
});
