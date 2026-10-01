import { describe, expect, it } from "vitest";
import {
   createAuthenticatedFeature,
   hostMatches,
   isFeatureEnabled,
   isRouteEnabled,
   parsePatterns,
   routeMatches,
} from "../shared";

const authenticatedFeature = createAuthenticatedFeature(
   ["/login", "/api/auth/**", "/api/cv-capabilities"],
   ["*.deno.net"],
);

describe("feature flag strategy", () => {
   it("matches wildcard subdomains without matching the apex or lookalike hosts", () => {
      expect(hostMatches("*.deno.net", "preview.deno.net")).toBe(true);
      expect(hostMatches("*.deno.net", "branch.preview.deno.net")).toBe(true);
      expect(hostMatches("*.deno.net", "deno.net")).toBe(false);
      expect(hostMatches("*.deno.net", "preview.deno.net.example.com")).toBe(false);
   });

   it("uses deployment-provided route ownership rules", () => {
      expect(routeMatches("/api/auth/**", "/api/auth/login")).toBe(true);
      expect(routeMatches("/api/auth/**", "/api/authenticators")).toBe(false);
      expect(routeMatches("/api/cv-capabilities", "/api/cv-capabilities")).toBe(true);
      expect(routeMatches("/api/cv-capabilities", "/api/cv-capabilities/extra")).toBe(false);
   });

   it("disables configured authenticated routes only on configured hosts", () => {
      expect(isFeatureEnabled(authenticatedFeature, { hostname: "branch.deno.net" })).toBe(false);
      expect(isRouteEnabled([authenticatedFeature], {
         hostname: "branch.deno.net",
         pathname: "/login",
      })).toBe(false);
      expect(isRouteEnabled([authenticatedFeature], {
         hostname: "branch.deno.net",
         pathname: "/api/auth/me",
      })).toBe(false);
      expect(isRouteEnabled([authenticatedFeature], {
         hostname: "branch.deno.net",
         pathname: "/p",
      })).toBe(true);
      expect(isRouteEnabled([authenticatedFeature], {
         hostname: "cv.example.com",
         pathname: "/login",
      })).toBe(true);
   });

   it("parses deployment policy, including an intentionally empty list", () => {
      expect(parsePatterns(" preview.example.com,*.internal.example ")).toEqual([
         "preview.example.com",
         "*.internal.example",
      ]);
      expect(parsePatterns("")).toEqual([]);
      expect(createAuthenticatedFeature([], []).routes).toEqual([]);
   });
});
