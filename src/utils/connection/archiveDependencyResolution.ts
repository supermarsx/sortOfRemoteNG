import type { StorageData } from "../storage/storage";
import type {
  AutomationEntry,
  AutomationFamily,
  AutomationScope,
  DatabaseAutomationLibrary,
} from "../../types/recording/automationLibrary";
import type { ArchiveDependencyIssue } from "./archiveDependencyDiagnostics";
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
  index?: number;
};
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
  const data = structuredClone(materializeDatabaseArchiveDefaults(source));
  const diagnostics = inspectDatabaseArchiveDependencies(databaseId, data);
  const candidates = new Map<string, Candidate>();
  const issues: ArchiveDependencyRepairIssue[] = [];
  for (const [i, issue] of diagnostics.issues.entries()) {
    const recycled = issue.path.startsWith("recycleBin.");
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
      const ref = row[field]?.items[index];
      if (ref && ref.id === issue.targetId) {
        candidate.field = field;
        candidate.index = index;
        if (issue.reason === "external-script") {
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
              candidate.entry = normalizeAutomationEntry(entry);
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
      safe = !recycled;
    } else if (row && issue.reason === "tab-group") {
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

/** Produces one complete replacement; callers commit it with a database CAS. */
export function applyArchiveDependencyRepair(
  review: ArchiveDependencyRepairReview,
  selected: readonly string[],
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
  for (const fix of review.issues.filter((item) => chosen.has(item.id))) {
    let row = data.connections.find((item) => item.id === fix.issue.recordId);
    if (!row && fix.recycled) {
      const entry = data.recycleBin!.entries.find(
        (item) => item.connection.id === fix.issue.recordId,
      );
      if (!entry)
        throw new Error("The recycled record changed. Review it again.");
      row = entry.connection;
      data.connections.push(row);
      data.recycleBin!.entries = data.recycleBin!.entries.filter(
        (item) => item !== entry,
      );
      data.recycleBin!.revision = crypto.randomUUID();
    }
    if (!row) throw new Error("The dependency owner changed. Review it again.");
    const candidate = receipt.candidates.get(fix.id)!;
    if (fix.action === "move-to-root") delete row.parentId;
    else if (fix.action === "reset-tab-group") delete row.defaultTabGroupId;
    else {
      const items = row[candidate.field!]?.items;
      const ref = items?.[candidate.index!];
      if (!items || !ref || ref.id !== fix.issue.targetId)
        throw new Error("The quick action changed. Review it again.");
      if (fix.action === "remove-reference")
        removed.set(items, [...(removed.get(items) ?? []), candidate.index!]);
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
        items[candidate.index!] = {
          ...ref,
          id,
          scope: { kind: "database", databaseId: review.databaseId },
        };
      }
    }
  }
  for (const [items, indices] of removed)
    for (const index of indices.sort((a, b) => b - a)) items.splice(index, 1);
  if (libraryChanged) library.revision++;
  data.automationLibrary = normalizeDatabaseAutomationLibrary(library);
  return {
    data,
    remaining: inspectDatabaseArchiveDependencies(review.databaseId, data),
    repaired: chosen.size,
  };
}
