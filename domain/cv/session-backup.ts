import type { CvDocumentProps, CvDocumentSummary } from "./types";

/**
 * Browser-side safety net for CV sessions: the latest source a client saw or wrote for a session.
 * Storage is the application's concern; these rules decide when a backup wins over the server copy
 * and which backed-up sessions a server that lost them must get back.
 */
export interface CvSessionBackup {
   markdown: string;
   css: string;
   /** Server revision the source is based on. */
   revision: number;
   /** The source has edits the server has not acknowledged. */
   pending: boolean;
   /** Session title when last seen, for listing a session the server no longer returns. */
   title?: string;
   /** Last local change (ms since epoch). */
   savedAt?: number;
}

export interface CvSessionBackupEntry extends CvSessionBackup {
   id: string;
}

/** A session listed from a backup because the server did not return it. */
export interface LocalOnlyCvSession extends CvDocumentSummary {
   localOnly: true;
}

/** Parse a stored backup; anything without complete source and an integer revision is rejected. */
export function parseCvSessionBackup(raw: unknown): CvSessionBackup | null {
   const value = raw as Partial<CvSessionBackup> | null;
   if (!value || typeof value !== "object" || typeof value.markdown !== "string" || typeof value.css !== "string" || !Number.isInteger(value.revision)) {
      return null;
   }
   return {
      markdown: value.markdown,
      css: value.css,
      revision: value.revision!,
      pending: Boolean(value.pending),
      title: typeof value.title === "string" ? value.title : undefined,
      savedAt: Number.isFinite(value.savedAt) ? value.savedAt : undefined,
   };
}

/** The CV name from the first Markdown heading, without its attribute block. */
export const cvTitleFromMarkdown = (markdown: string): string | undefined =>
   markdown.match(/^#\s+(.+)$/m)?.[1]?.replace(/\s*\{[^{}]+\}\s*$/, "").trim() || undefined;

const routeIdPattern = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

/** Session route ids the editor creates (UUID v4 or 32-hex migrated ids). */
export const isCvRouteId = (id: string): boolean => routeIdPattern.test(id);

/**
 * Whether the backup should replace what the server returned: the server lost the session,
 * is behind this client, or never received its last edit.
 */
export function shouldRestoreCvBackup(
   backup: CvSessionBackup | null,
   server: Pick<CvDocumentProps, "markdown" | "css" | "revision"> | null | undefined,
): backup is CvSessionBackup {
   if (!backup) return false;
   if (!server) return true;
   if (backup.revision > server.revision) return true;
   return backup.pending && backup.revision === server.revision
      && (backup.markdown !== server.markdown || backup.css !== server.css);
}

const recoverable = (known: Set<string>) => (backup: CvSessionBackupEntry) =>
   !known.has(backup.id) && isCvRouteId(backup.id) && Boolean(backup.markdown.trim());

/** Backed-up sessions the server does not have and that should be re-created there. */
export function cvSessionsToRecover(server: CvDocumentSummary[], backups: CvSessionBackupEntry[]): CvSessionBackupEntry[] {
   return backups.filter(recoverable(new Set(server.map(document => document.id))));
}

/** Server sessions plus backed-up sessions the server is missing, newest first. */
export function mergeCvSessions(
   server: CvDocumentSummary[],
   backups: CvSessionBackupEntry[],
): Array<CvDocumentSummary | LocalOnlyCvSession> {
   const localOnly: LocalOnlyCvSession[] = cvSessionsToRecover(server, backups).map(backup => ({
      id: backup.id,
      title: backup.title ?? cvTitleFromMarkdown(backup.markdown),
      revision: backup.revision,
      updatedAt: new Date(backup.savedAt ?? 0).toISOString(),
      localOnly: true,
   }));
   return [...server, ...localOnly].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
