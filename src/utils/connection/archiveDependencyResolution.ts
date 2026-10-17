import type { StorageData } from "../storage/storage";
import type {
  AutomationEntry,
  AutomationFamily,
  AutomationScope,
  DatabaseAutomationLibrary,
} from "../../types/recording/automationLibrary";
import type { ArchiveDependencyIssue } from "./archiveDependencyDiagnostics";
import { archiveDependencyPath } from "./archiveDependencyDiagnostics";
import { MAX_ARCHIVE_DEPENDENCY_SCAN_ISSUES } from "./archiveDependencyDiagnostics";
import {
  normalizeQuickActionReferences,
  quickActionReferenceKey,
} from "./sessionQuickActions";
import { normalizeDatabaseDocuments } from "../documents/validation";
import {
  inspectDatabaseArchiveDependencies,
  materializeDatabaseArchiveDefaults,
} from "./fullDatabaseArchive";
import {
  normalizeAutomationEntry,
  normalizeDatabaseAutomationLibrary,
} from "../recording/automationLibraryValidation";
import { stableJsonStringify } from "../core/stableJsonStringify";

type ReadSource = (
  scope: AutomationScope,
  family: AutomationFamily,
  id: string,
) => Promise<AutomationEntry | undefined>;
export interface ArchiveDependencyRepairIssue {
  id: string;
  issue: ArchiveDependencyIssue;
  safe: boolean;
  action:
    | "copy-and-rebind"
    | "remove-reference"
    | "move-to-root"
    | "reset-tab-group"
    | "manual";
  recycled: boolean;
}
export interface ArchiveDependencyRepairReview {
  databaseId: string;
  data: StorageData;
  issues: ArchiveDependencyRepairIssue[];
}
type Candidate = {
  entry?: AutomationEntry;
  field?: "sshQuickActions" | "httpAutomation";
  indices?: number[];
  referenceKey?: string;
  mutation?: "totp" | "legacy" | "document" | "document-folder";
};

/** Paths are emitted by the checker; never interpret them as JavaScript or raw property names. */
function documentMutation(
  data: StorageData,
  issue: ArchiveDependencyIssue,
): (() => void) | undefined {
  const documents = data.documents!;
  for (const category of ["documents", "people", "tickets"] as const) {
    for (const [index, doc] of documents[category].entries()) {
      if (doc.id !== issue.recordId) continue;
      const walk = (
        value: unknown,
        path: string,
        parent?: Record<string, unknown> | unknown[],
        key?: string | number,
      ): (() => void) | undefined => {
        if (
          path === issue.path &&
          value &&
          typeof value === "object" &&
          "id" in value &&
          value.id === issue.targetId &&
          parent
        ) {
          if (Array.isArray(parent))
            return () => {
              const position = parent.indexOf(value);
              if (position >= 0) parent.splice(position, 1);
            };
          if (parent.type === "reference")
            return () => {
              const blockId = parent.id;
              for (const property of Object.keys(parent))
                delete parent[property];
              Object.assign(
                parent,
                typeof blockId === "string"
                  ? { id: blockId, type: "note", text: "" }
                  : { type: "text", text: "" },
              );
            };
          return () => {
            delete parent[String(key)];
          };
        }
        if (Array.isArray(value)) {
          for (const [i, child] of value.entries()) {
            const found = walk(child, `${path}[${i}]`, value, i);
            if (found) return found;
          }
        } else if (value && typeof value === "object") {
          for (const [i, [field, child]] of Object.entries(value).entries()) {
            const found = walk(
              child,
              archiveDependencyPath(path, field, i),
              value as Record<string, unknown>,
              field,
            );
            if (found) return found;
          }
        }
      };
      const found = walk(doc, `documents.${category}[${index}]`);
      if (found) return found;
    }
  }
}
const receipts = new WeakMap<
  ArchiveDependencyRepairReview,
  {
    databaseId: string;
    fingerprint: string;
    candidates: Map<string, Candidate>;
    issues: string;
  }
>();

function family(field: string, kind: string): AutomationFamily {
  return `${field === "sshQuickActions" ? "terminal" : "website"}-${kind}` as AutomationFamily;
}
function payloads(
  library: DatabaseAutomationLibrary,
  kind: AutomationFamily,
): AutomationEntry["payload"][] {
  return kind === "terminal-script"
    ? [
        ...library.terminalScripts.customScripts,
        ...library.terminalScripts.modifiedDefaults,
      ]
    : kind === "terminal-macro"
      ? library.terminalMacros
      : kind === "website-script"
        ? library.website.scripts
        : library.website.macros;
}
// Match the executable payload and all execution-affecting metadata, never just a name.
function content(entry: AutomationEntry): string {
  const {
    id: _id,
    name: _name,
    createdAt: _created,
    updatedAt: _updated,
    ...body
  } = entry.payload;
  return stableJsonStringify({ family: entry.family, body });
}

export async function prepareArchiveDependencyRepair(
  databaseId: string,
  source: StorageData,
  readSource: ReadSource,
): Promise<ArchiveDependencyRepairReview> {
  return prepareRepair(databaseId, source, readSource, true);
}

async function prepareRepair(
  databaseId: string,
  source: StorageData,
  readSource: ReadSource,
  readRecycledSources: boolean,
): Promise<ArchiveDependencyRepairReview> {
  const data = structuredClone(materializeDatabaseArchiveDefaults(source));
  // In-memory callers can share nested objects between active/recycled rows.
  // Editing one owner must never repair another owner through an alias.
  data.connections = data.connections.map((row) => structuredClone(row));
  data.recycleBin!.entries = data.recycleBin!.entries.map((entry) =>
    structuredClone(entry),
  );
  const diagnostics = inspectDatabaseArchiveDependencies(
    databaseId,
    data,
    readRecycledSources
      ? {}
      : { maximumIssues: MAX_ARCHIVE_DEPENDENCY_SCAN_ISSUES },
  );
  const candidates = new Map<string, Candidate>();
  const issues: ArchiveDependencyRepairIssue[] = [];
  for (const [i, issue] of diagnostics.issues.entries()) {
    const recycled = issue.path.startsWith("recycleBin.");
    if (
      !readRecycledSources &&
      (recycled || issue.reason !== "external-script")
    ) {
      const id = `repair-${i}`;
      candidates.set(id, {});
      issues.push({ id, issue, action: "manual", safe: false, recycled });
      continue;
    }
    const row = recycled
      ? data.recycleBin!.entries.find(
          (item) => item.connection.id === issue.recordId,
        )?.connection
      : data.connections.find((item) => item.id === issue.recordId);
    let action: ArchiveDependencyRepairIssue["action"] = "manual";
    let safe = false;
    const candidate: Candidate = {};
    const match = /\.(sshQuickActions|httpAutomation)\.items\[(\d+)\]$/.exec(
      issue.path,
    );
    if (row && match && ["script", "external-script"].includes(issue.reason)) {
      const field = match[1] as "sshQuickActions" | "httpAutomation",
        index = Number(match[2]);
      const items = row[field]?.items;
      const ref = items && normalizeQuickActionReferences(items)[index];
      if (ref && ref.id === issue.targetId) {
        candidate.field = field;
        candidate.referenceKey = quickActionReferenceKey(ref);
        candidate.indices = items!.flatMap((item, index) =>
          quickActionReferenceKey(item) === candidate.referenceKey
            ? [index]
            : [],
        );
        if (
          issue.reason === "external-script" &&
          (!recycled || readRecycledSources)
        ) {
          try {
            const entry = await readSource(
              ref.scope ?? { kind: "app" },
              family(field, ref.kind),
              ref.id,
            );
            if (
              entry &&
              entry.family === family(field, ref.kind) &&
              entry.payload.id === ref.id
            )
              candidate.entry = structuredClone(
                normalizeAutomationEntry(entry),
              );
          } catch {
            /* Locked/unavailable source remains an explicit choice to remove. */
          }
        }
        action = candidate.entry ? "copy-and-rebind" : "remove-reference";
        safe = !!candidate.entry && !recycled;
      }
    } else if (
      row &&
      ["folder", "cycle"].includes(issue.reason) &&
      issue.path.endsWith(".parentId")
    ) {
      action = "move-to-root";
      safe = issue.reason === "folder" && !recycled;
    } else if (
      row &&
      issue.reason === "totp" &&
      row.credentialSource?.kind === "vault" &&
      row.credentialSource.totpId === issue.targetId
    ) {
      action = "remove-reference";
      candidate.mutation = "totp";
    } else if (row && issue.reason === "legacy-script") {
      action = "remove-reference";
      candidate.mutation = "legacy";
    } else if (
      issue.reason === "folder" &&
      issue.path.startsWith("documents.documents[") &&
      issue.path.endsWith(".parentFolderId")
    ) {
      action = "move-to-root";
      safe = true;
      candidate.mutation = "document-folder";
    } else if (
      ["document", "external-document", "cell"].includes(issue.reason)
    ) {
      const trial = structuredClone(data),
        remove = documentMutation(trial, issue);
      if (remove) {
        try {
          remove();
          normalizeDatabaseDocuments(trial.documents);
          action = "remove-reference";
          candidate.mutation = "document";
        } catch {
          /* Required/unsupported structures remain manual. */
        }
      }
    } else if (
      row &&
      issue.reason === "tab-group" &&
      issue.path ===
        (recycled
          ? `recycleBin.entries[${data.recycleBin!.entries.findIndex((item) => item.connection === row)}].connection.defaultTabGroupId`
          : `connections[${data.connections.indexOf(row)}].defaultTabGroupId`)
    ) {
      action = "reset-tab-group";
      safe = !recycled;
    }
    const id = `repair-${i}`;
    candidates.set(id, candidate);
    issues.push({ id, issue, action, safe, recycled });
  }
  const review = { databaseId, data, issues };
  receipts.set(review, {
    databaseId,
    fingerprint: stableJsonStringify(data),
    candidates,
    issues: stableJsonStringify(issues),
  });
  return review;
}

/** One automatic pass only copies readable live automation references. Callers
 * own source/access revalidation and the destination database CAS. Bounded
 * diagnostics may leave further issues; this never claims full closure. */
export async function repairSafeArchiveDependencies(
  databaseId: string,
  source: StorageData,
  readSource: ReadSource,
) {
  const original = structuredClone(source);
  const review = await prepareRepair(databaseId, original, readSource, false);
  const selected = review.issues
    .filter(
      (item) =>
        item.safe && !item.recycled && item.action === "copy-and-rebind",
    )
    .map((item) => item.id);
  if (!selected.length)
    return {
      data: original,
      remaining: inspectDatabaseArchiveDependencies(databaseId, review.data),
      repaired: 0,
    };
  const applied = applyArchiveDependencyRepair(review, selected, {
    restoreRecycled: false,
  });
  // Review normalization is for validation, not permission to persist unrelated
  // archive defaults. Rebase only copied library content and active references.
  const data = original;
  data.connections = data.connections.map((row, index) => {
    const replacement = structuredClone(row);
    for (const field of ["sshQuickActions", "httpAutomation"] as const) {
      const before = review.data.connections[index][field]?.items;
      const after = applied.data.connections[index][field]?.items;
      if (
        stableJsonStringify(before ?? null) ===
        stableJsonStringify(after ?? null)
      )
        continue;
      const config = replacement[field];
      if (!config || !after)
        throw new Error("The quick action changed. Review it again.");
      const items = structuredClone(after);
      if (field === "sshQuickActions")
        replacement.sshQuickActions = {
          ...replacement.sshQuickActions!,
          items,
        };
      else
        replacement.httpAutomation = { ...replacement.httpAutomation!, items };
    }
    return replacement;
  });
  data.automationLibrary = applied.data.automationLibrary;
  return {
    data,
    repaired: applied.repaired,
    remaining: inspectDatabaseArchiveDependencies(databaseId, data),
  };
}

/** Produces one complete replacement; callers commit it with a database CAS. */
export function applyArchiveDependencyRepair(
  review: ArchiveDependencyRepairReview,
  selected: readonly string[],
  options: { restoreRecycled?: boolean } = {},
) {
  const receipt = receipts.get(review);
  if (
    !receipt ||
    receipt.databaseId !== review.databaseId ||
    receipt.fingerprint !== stableJsonStringify(review.data) ||
    receipt.issues !== stableJsonStringify(review.issues)
  )
    throw new Error(
      "The dependency review changed. Review it again before applying fixes.",
    );
  const chosen = new Set(selected);
  if (
    chosen.size !== selected.length ||
    selected.some(
      (id) =>
        !review.issues.some((row) => row.id === id && row.action !== "manual"),
    )
  )
    throw new Error("Unknown dependency repair choice.");
  const data = structuredClone(review.data);
  const library = normalizeDatabaseAutomationLibrary(data.automationLibrary);
  data.automationLibrary = library;
  const removed = new Map<
    NonNullable<StorageData["connections"][number]["sshQuickActions"]>["items"],
    number[]
  >();
  let libraryChanged = false;
  const removedLegacy = new Map<unknown[], number[]>();
  let documentsChanged = false;
  // Capture references before any array removal shifts the checker's indexed paths.
  const documentRemovals = review.issues
    .filter(
      (item) =>
        chosen.has(item.id) &&
        receipt.candidates.get(item.id)?.mutation === "document",
    )
    .map((item) => documentMutation(data, item.issue));
  if (documentRemovals.some((item) => !item))
    throw new Error("The document reference changed. Review it again.");
  for (const fix of review.issues.filter((item) => chosen.has(item.id))) {
    const candidate = receipt.candidates.get(fix.id)!;
    if (candidate.mutation === "document") {
      documentsChanged = true;
      continue;
    }
    if (candidate.mutation === "document-folder") {
      const doc = data.documents!.documents.find(
        (item) => item.id === fix.issue.recordId,
      );
      if (!doc) throw new Error("The document changed. Review it again.");
      doc.parentFolderId = null;
      documentsChanged = true;
      continue;
    }
    let row = data.connections.find((item) => item.id === fix.issue.recordId);
    if (!row && fix.recycled) {
      const entry = data.recycleBin!.entries.find(
        (item) => item.connection.id === fix.issue.recordId,
      );
      if (!entry)
        throw new Error("The recycled record changed. Review it again.");
      row = entry.connection;
      if (options.restoreRecycled !== false) {
        data.connections.push(row);
        data.recycleBin!.entries = data.recycleBin!.entries.filter(
          (item) => item !== entry,
        );
      }
      data.recycleBin!.revision = crypto.randomUUID();
    }
    if (!row) throw new Error("The dependency owner changed. Review it again.");
    if (candidate.mutation === "totp") {
      if (
        row.credentialSource?.kind !== "vault" ||
        row.credentialSource.totpId !== fix.issue.targetId
      )
        throw new Error("The credential changed. Review it again.");
      delete row.credentialSource.totpId;
    } else if (candidate.mutation === "legacy") {
      if (fix.issue.path.endsWith(".scripts")) delete row.scripts;
      else {
        const actionPath =
          /\.behaviorAutomation\.rules\[(\d+)\]\.actions\[(\d+)\]$/.exec(
            fix.issue.path,
          );
        if (!actionPath)
          throw new Error("The lifecycle action changed. Review it again.");
        const actions =
          row.behaviorAutomation?.rules[Number(actionPath[1])]?.actions;
        const index = Number(actionPath[2]);
        if (!actions || actions[index]?.type !== "runCustomScript")
          throw new Error("The lifecycle action changed. Review it again.");
        removedLegacy.set(actions, [
          ...(removedLegacy.get(actions) ?? []),
          index,
        ]);
      }
    } else if (fix.action === "move-to-root") delete row.parentId;
    else if (fix.action === "reset-tab-group") delete row.defaultTabGroupId;
    else {
      const items = row[candidate.field!]?.items;
      const indices = candidate.indices!;
      const ref = items?.[indices[0]];
      if (
        !items ||
        !ref ||
        indices.some(
          (index) =>
            !items[index] ||
            quickActionReferenceKey(items[index]) !== candidate.referenceKey,
        )
      )
        throw new Error("The quick action changed. Review it again.");
      if (fix.action === "remove-reference")
        removed.set(items, [...(removed.get(items) ?? []), ...indices]);
      else {
        const entry = candidate.entry!;
        const existing = payloads(library, entry.family).find(
          (payload) =>
            content({ family: entry.family, payload } as AutomationEntry) ===
            content(entry),
        );
        let id = existing?.id;
        if (!id) {
          id = crypto.randomUUID();
          const names = new Set(
            payloads(library, entry.family).map((payload) => payload.name),
          );
          let name = entry.payload.name,
            suffix = 2;
          while (names.has(name))
            name = `${entry.payload.name.slice(0, 240)} (${suffix++})`;
          const copied = normalizeAutomationEntry({
            ...entry,
            payload: { ...entry.payload, id, name },
          });
          if (copied.family === "terminal-script")
            library.terminalScripts.customScripts.push(copied.payload);
          else if (copied.family === "terminal-macro")
            library.terminalMacros.push(copied.payload);
          else if (copied.family === "website-script")
            library.website.scripts.push(copied.payload);
          else library.website.macros.push(copied.payload);
          if (copied.provenance)
            library.provenance[`${copied.family}:${id}`] = copied.provenance;
          libraryChanged = true;
        }
        for (const index of indices)
          items[index] = {
            ...items[index],
            id,
            scope: { kind: "database", databaseId: review.databaseId },
          };
      }
    }
  }
  for (const [items, indices] of removed)
    for (const index of indices.sort((a, b) => b - a)) items.splice(index, 1);
  if (libraryChanged) library.revision++;
  for (const [actions, indices] of removedLegacy)
    for (const index of indices.sort((a, b) => b - a)) actions.splice(index, 1);
  for (const remove of documentRemovals) remove!();
  if (documentsChanged) {
    data.documents!.revision++;
    data.documents = normalizeDatabaseDocuments(data.documents);
  }
  data.automationLibrary = normalizeDatabaseAutomationLibrary(library);
  return {
    data,
    remaining: inspectDatabaseArchiveDependencies(review.databaseId, data),
    repaired: chosen.size,
  };
}
