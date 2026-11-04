/**
 * Document format versioning.
 *
 * Every saved document carries `format` and `version`. When the format
 * changes, bump FORMAT_VERSION in types.ts and add a step to MIGRATIONS that
 * upgrades version N to N+1. Documents are migrated on load; never mutate the
 * format without a migration (see DOCUMENT_FORMAT.md).
 */
import { defaultTokens } from "./document";
import { FORMAT_ID, FORMAT_VERSION, type DesignDocument } from "./types";

type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades a version-n document to version n+1. */
const MIGRATIONS: Record<number, Migration> = {};

export class FormatError extends Error {}

export function migrate(raw: unknown): DesignDocument {
  if (!raw || typeof raw !== "object") throw new FormatError("not a document");
  let doc = raw as Record<string, unknown>;
  if (doc.format !== FORMAT_ID) throw new FormatError(`not a Roblox UI Studio document (format=${String(doc.format)})`);
  let v = Number(doc.version);
  if (!Number.isInteger(v) || v < 1) throw new FormatError(`invalid document version ${String(doc.version)}`);
  if (v > FORMAT_VERSION) throw new FormatError(`document version ${v} is newer than this app supports (${FORMAT_VERSION}); update Roblox UI Studio`);
  while (v < FORMAT_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) throw new FormatError(`no migration from version ${v}`);
    doc = step(doc);
    v++;
    doc.version = v;
  }
  // Defensive defaults for optional collections.
  doc.components ??= {};
  doc.animations ??= {};
  doc.meta ??= {};
  doc.tokens ??= defaultTokens();
  return doc as unknown as DesignDocument;
}
