import { mountVendor, useMediator } from "../../cqrs";
import { CvTemplate } from "../../domain/cv/template";
import type { CvTemplateRepository } from "../../repos/cv-template.repo";
import type { CvApplication } from "../../domain/cv/application";
import { assertExpectedRevision } from "../../domain/cv/version";
import type { CvApplicationRepository } from "../../repos/cv-application.repo";
import type {
   CvDocumentPort,
   CvDocumentRecord,
   CvDocumentSummary,
   UpdateCvDocumentInput,
} from "../../repos/cv-document.repo";

/** The mediator is a process singleton; tests reuse the one instance. */
export function testMediator() {
   mountVendor();
   return useMediator();
}

const templateKey = (id: string, version: number) => `${id}@${version}`;

export class InMemoryCvTemplateRepo implements CvTemplateRepository {
   readonly saved: CvTemplate[] = [];
   private store = new Map<string, CvTemplate>();

   constructor(seed: CvTemplate[] = []) {
      for (const template of seed) this.store.set(templateKey(template.id, template.version), template);
   }

   async list(): Promise<CvTemplate[]> { return [...this.store.values()]; }

   async get(id: string, version?: number): Promise<CvTemplate | null> {
      if (version !== undefined) return this.store.get(templateKey(id, version)) ?? null;
      const versions = [...this.store.values()].filter(template => template.id === id);
      if (!versions.length) return null;
      return versions.reduce((latest, template) => (template.version > latest.version ? template : latest));
   }

   async save(template: CvTemplate): Promise<void> {
      this.store.set(templateKey(template.id, template.version), template);
      this.saved.push(template);
   }
}

export function makeTemplate(overrides: Partial<ReturnType<CvTemplate["toJSON"]>> = {}): CvTemplate {
   return CvTemplate.create({
      id: "harvard",
      version: 1,
      name: "Harvard",
      markdownSkeleton: ":::resume\n\n# YOUR NAME {.cv-name}\n\n:::\n",
      css: ".resume { padding: 1rem; }\n",
      capabilities: { pageFormats: ["A4"], supportsPhoto: false, atsFriendly: true },
      builtIn: true,
      tags: ["public"],
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
   });
}

/** Mirrors the revision/conflict contract of the Nitro-backed document store. */
export class InMemoryCvDocumentRepo implements CvDocumentPort {
   readonly events: { id: string; sourceId?: string }[] = [];
   private store = new Map<string, CvDocumentRecord>();
   private clock = 0;

   private now(): string {
      return new Date(Date.UTC(2026, 0, 1) + ++this.clock * 1000).toISOString();
   }

   async listCvDocuments(): Promise<CvDocumentSummary[]> {
      return [...this.store.values()].map(({ id, title, revision, updatedAt }) => ({ id, title, revision, updatedAt }));
   }

   async getCvDocument(id: string): Promise<CvDocumentRecord> {
      const document = this.store.get(id);
      if (!document) throw new Error(`CV document ${id} not found`);
      return { ...document };
   }

   async createCvDocument(id: string, input: Pick<UpdateCvDocumentInput, "title" | "markdown" | "css" | "sourceId">): Promise<CvDocumentRecord> {
      if (this.store.has(id)) throw new Error(`CV document ${id} already exists`);
      const document: CvDocumentRecord = {
         id,
         title: input.title,
         markdown: input.markdown ?? "",
         css: input.css ?? "",
         revision: 1,
         updatedAt: this.now(),
      };
      this.store.set(id, document);
      this.events.push({ id, sourceId: input.sourceId });
      return { ...document };
   }

   async removeCvDocument(id: string): Promise<void> {
      this.store.delete(id);
   }

   async updateCvDocument(id: string, input: UpdateCvDocumentInput): Promise<CvDocumentRecord> {
      const current = await this.getCvDocument(id);
      if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
         throw new Error("CV document revision conflict");
      }
      const next: CvDocumentRecord = {
         ...current,
         title: input.title ?? current.title,
         markdown: input.markdown ?? current.markdown,
         css: input.css ?? current.css,
         revision: current.revision + 1,
         updatedAt: this.now(),
      };
      this.store.set(id, next);
      this.events.push({ id, sourceId: input.sourceId });
      return { ...next };
   }
}

export class InMemoryCvApplicationRepo implements CvApplicationRepository {
   failNextUpdate?: Error;
   private store = new Map<string, CvApplication>();

   async create(application: CvApplication): Promise<void> {
      if (this.store.has(application.id)) throw new Error("CV application already exists");
      this.store.set(application.id, application);
   }

   async get(id: string, ownerId: string): Promise<CvApplication | null> {
      const application = this.store.get(id);
      return application && application.ownerId === ownerId ? application : null;
   }

   async update(application: CvApplication, expectedRevision: number): Promise<void> {
      if (this.failNextUpdate) {
         const error = this.failNextUpdate;
         this.failNextUpdate = undefined;
         throw error;
      }
      const current = this.store.get(application.id);
      if (!current || current.ownerId !== application.ownerId) throw new Error("CV application not found");
      assertExpectedRevision(expectedRevision, current.revision);
      this.store.set(application.id, application);
   }
}
