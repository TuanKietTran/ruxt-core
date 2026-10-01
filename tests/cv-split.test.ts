import { describe, expect, it } from "vitest";
import {
   classifyCvContact,
   extractCvProfile,
   plainCvText,
   splitCvApplication,
   toCvTemplateSkeleton,
} from "../domain/cv/split";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const referenceCv = readFileSync(fileURLToPath(new URL("./fixtures/reference-cv.md", import.meta.url)), "utf8");

describe("plainCvText", () => {
   it("reduces inline Markdown to readable text", () => {
      expect(plainCvText("**Bold** and *italic* and `code`")).toBe("Bold and italic and code");
      expect(plainCvText("[linkedin.com/in/me](https://linkedin.com/in/me)")).toBe("linkedin.com/in/me");
      expect(plainCvText("![alt](img.png)")).toBe("alt");
      expect(plainCvText("# Heading {.cv-name}")).toBe("# Heading");
      expect(plainCvText("a\\|b")).toBe("a|b");
   });
});

describe("classifyCvContact", () => {
   it("recognises each supported contact kind", () => {
      expect(classifyCvContact("[me@example.com](mailto:me@example.com)")).toEqual({
         kind: "email", label: "me@example.com", value: "me@example.com",
      });
      expect(classifyCvContact("+1 555 0100")?.kind).toBe("phone");
      expect(classifyCvContact("[linkedin.com/in/me](https://linkedin.com/in/me)")?.kind).toBe("linkedin");
      expect(classifyCvContact("[gh](https://github.com/me)")?.kind).toBe("github");
      expect(classifyCvContact("[site](https://example.com)")?.kind).toBe("website");
   });

   it("returns null for prose that is not a contact", () => {
      expect(classifyCvContact("City, Country")).toBeNull();
      expect(classifyCvContact("")).toBeNull();
   });
});

describe("extractCvProfile on the Harvard table layout", () => {
   const profile = extractCvProfile(referenceCv);

   it("reads identity and header contacts", () => {
      expect(profile.version).toBe(1);
      expect(profile.identity.fullName).toBe("YOUR NAME");
      expect(profile.identity.location).toBe("City, Country");
      expect(profile.contacts.map(contact => contact.kind)).toEqual(["email", "phone", "linkedin"]);
   });

   it("reads education rows including location and dates", () => {
      const [education] = profile.education;
      expect(education?.school).toBe("UNIVERSITY NAME");
      expect(education?.location).toBe("City, Country");
      expect(education?.degree).toContain("Degree, Field of Study");
      expect(education?.start).toBe("Month Year");
      expect(education?.end).toBe("Month Year");
      expect(education?.details).toContain("Relevant coursework");
   });

   it("reads every experience-like section entry with highlights", () => {
      expect(profile.experiences.length).toBeGreaterThanOrEqual(3);
      const [current] = profile.experiences;
      expect(current?.company).toBe("ORGANIZATION NAME");
      expect(current?.title).toBe("Job Title");
      expect(current?.end).toBe("Present");
      expect(current?.highlights.length).toBe(3);
      expect(current?.highlights[0]).toMatch(/^Start each bullet/);
   });

   it("reads projects with url, description and bullets", () => {
      const [project] = profile.projects;
      expect(project?.name).toBe("PROJECT NAME");
      expect(project?.url).toBe("https://example.com");
      expect(project?.description).toContain("One sentence describing");
   });

   it("separates skill groups from spoken languages", () => {
      expect(profile.skills.map(group => group.name)).toContain("Technical");
      expect(profile.skills.find(group => group.name === "Technical")?.skills.length).toBe(3);
      expect(profile.languages.length).toBe(2);
      expect(profile.skills.some(group => group.name === "Languages")).toBe(false);
   });
});

describe("extractCvProfile on the pipeline heading layout", () => {
   const markdown = [
      "# Ada Lovelace {.cv-name}",
      "",
      "Analytical Engine Programmer · London, UK · <ada@example.org>",
      "",
      "## Summary",
      "",
      "First computer programmer.",
      "",
      "## Experience",
      "",
      "### Mathematician — Analytical Society",
      "",
      "*London, UK · 1842 – 1843*",
      "",
      "- Published the first algorithm",
      "",
      "## Skills",
      "",
      "**Technical:** Algorithms, Mathematics",
      "",
      "## Certifications",
      "",
      "- Royal Society Fellow",
   ].join("\n");
   const profile = extractCvProfile(markdown);

   it("reads identity, headline and summary", () => {
      expect(profile.identity.fullName).toBe("Ada Lovelace");
      expect(profile.identity.headline).toBe("Analytical Engine Programmer");
      expect(profile.identity.location).toBe("London, UK");
      expect(profile.identity.summary).toBe("First computer programmer.");
      expect(profile.contacts).toEqual([{ kind: "email", label: "ada@example.org", value: "ada@example.org" }]);
   });

   it("reads `###` entries and their italic metadata line", () => {
      expect(profile.experiences).toEqual([{
         title: "Mathematician",
         company: "Analytical Society",
         location: "London, UK",
         start: "1842",
         end: "1843",
         highlights: ["Published the first algorithm"],
      }]);
   });

   it("reads labelled skills and certification bullets", () => {
      expect(profile.skills).toEqual([{ name: "Technical", skills: ["Algorithms", "Mathematics"] }]);
      expect(profile.certifications).toEqual([{ name: "Royal Society Fellow" }]);
   });

   it("ignores fenced code and never throws on empty input", () => {
      expect(extractCvProfile("").identity.fullName).toBe("");
      const fenced = extractCvProfile("# Name\n\n## Skills\n\n```\n**Fake:** Nope\n```\n");
      expect(fenced.skills).toEqual([]);
   });
});

describe("toCvTemplateSkeleton", () => {
   const skeleton = toCvTemplateSkeleton(referenceCv);

   it("keeps directives, page breaks, section headings and table shape", () => {
      expect(skeleton.startsWith(":::resume")).toBe(true);
      expect(skeleton.trimEnd().endsWith(":::")).toBe(true);
      expect(skeleton).toContain("## Education");
      expect(skeleton).toContain("## Skills & Interests");
      expect(skeleton).toContain("| :-- | --: |");
      expect(skeleton.split("\n").length).toBe(referenceCv.split("\n").length);
   });

   it("replaces the name heading while preserving its attributes", () => {
      expect(skeleton).toContain("# YOUR NAME {.cv-name}");
   });

   it("removes personal contact details", () => {
      const personal = toCvTemplateSkeleton("City, Country · [ada@example.org](mailto:ada@example.org) · +44 20 7946 0000");
      expect(personal).toBe("City, Country · [email@example.com](mailto:email@example.com) · +1 555 0100");
   });

   it("is idempotent and leaves fenced code untouched", () => {
      expect(toCvTemplateSkeleton(skeleton)).toBe(skeleton);
      const fenced = "```\nmy secret note\n```";
      expect(toCvTemplateSkeleton(fenced)).toBe(fenced);
   });
});

describe("splitCvApplication", () => {
   it("returns both halves of one session", () => {
      const { profile, markdownSkeleton } = splitCvApplication(referenceCv);
      expect(profile).toEqual(extractCvProfile(referenceCv));
      expect(markdownSkeleton).toBe(toCvTemplateSkeleton(referenceCv));
   });
});
