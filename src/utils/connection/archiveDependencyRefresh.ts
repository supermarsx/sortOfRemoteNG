import type { Connection } from "../../types/connection/connection";
import type { StorageData } from "../storage/storage";
import { stableJsonStringify } from "../core/stableJsonStringify";
import { normalizeDatabaseAutomationLibrary } from "../recording/automationLibraryValidation";
import {
  normalizeSshQuickActions,
  normalizeHttpAutomation,
} from "./sessionQuickActions";

const equal = (a: unknown, b: unknown) =>
  stableJsonStringify(a ?? null) === stableJsonStringify(b ?? null);
const fail = (): never => {
  throw new Error(
    "The dependency repair changed other database data. Reload before saving.",
  );
};
const fields = ["sshQuickActions", "httpAutomation"] as const;
const sameActions = (
  field: (typeof fields)[number],
  left: Connection[(typeof fields)[number]],
  right: Connection[(typeof fields)[number]],
) => {
  const normalize =
    field === "sshQuickActions"
      ? normalizeSshQuickActions
      : normalizeHttpAutomation;
  return equal(normalize(left), normalize(right));
};

/** Only additive library copies and active quick-action rebinding may keep a live lease. */
export function assertArchiveDependencyRefresh(
  databaseId: string,
  before: StorageData,
  after: StorageData,
): void {
  const strip = (data: StorageData) => {
    const {
      connections,
      automationLibrary: _library,
      recordMetadata: _metadata,
      timestamp: _timestamp,
      ...body
    } = data;
    return {
      ...body,
      connections: connections.map((row) => {
        const { sshQuickActions: _ssh, httpAutomation: _http, ...rest } = row;
        return rest;
      }),
    };
  };
  if (!equal(strip(before), strip(after))) fail();
  const oldLibrary = normalizeDatabaseAutomationLibrary(
    before.automationLibrary,
  );
  const library = normalizeDatabaseAutomationLibrary(after.automationLibrary);
  const oldArrays = [
    oldLibrary.terminalScripts.customScripts,
    oldLibrary.terminalScripts.modifiedDefaults,
    oldLibrary.terminalMacros,
    oldLibrary.website.scripts,
    oldLibrary.website.macros,
  ];
  const arrays = [
    library.terminalScripts.customScripts,
    library.terminalScripts.modifiedDefaults,
    library.terminalMacros,
    library.website.scripts,
    library.website.macros,
  ];
  for (let i = 0; i < arrays.length; i++) {
    if (!equal(oldArrays[i], arrays[i].slice(0, oldArrays[i].length))) fail();
  }
  const libraryBody = (value: typeof library) => ({
    ...value,
    revision: 0,
    provenance: {},
    terminalMacros: [],
    terminalScripts: {
      ...value.terminalScripts,
      customScripts: [],
      modifiedDefaults: [],
    },
    website: { ...value.website, scripts: [], macros: [] },
  });
  if (!equal(libraryBody(oldLibrary), libraryBody(library))) fail();
  for (const [key, value] of Object.entries(oldLibrary.provenance))
    if (!equal(value, library.provenance[key])) fail();
  for (let i = 0; i < before.connections.length; i++) {
    const old = before.connections[i],
      next = after.connections[i];
    for (const field of fields) {
      const left = old[field],
        right = next[field];
      if (equal(left, right)) continue;
      if (!left || !right) return fail();
      if (
        !equal({ ...left, items: [] }, { ...right, items: [] }) ||
        left.items.length !== right.items.length
      )
        fail();
      for (let j = 0; j < left.items.length; j++) {
        const from = left.items[j],
          to = right.items[j];
        if (equal(from, to)) continue;
        const entries =
          field === "sshQuickActions"
            ? to.kind === "script"
              ? [
                  ...library.terminalScripts.customScripts,
                  ...library.terminalScripts.modifiedDefaults,
                ]
              : library.terminalMacros
            : to.kind === "script"
              ? library.website.scripts
              : library.website.macros;
        if (
          from.kind !== to.kind ||
          !equal(
            { ...from, id: "", scope: null },
            { ...to, id: "", scope: null },
          ) ||
          (from.scope?.kind === "database" &&
            from.scope.databaseId === databaseId) ||
          to.scope?.kind !== "database" ||
          to.scope.databaseId !== databaseId ||
          !entries.some((item) => item.id === to.id)
        )
          fail();
      }
    }
  }
}

/** Retain ordinary concurrent edits, additions/removals and ordering; refuse same-field conflicts. */
export function mergeArchiveDependencyRows(
  before: StorageData,
  after: StorageData,
  current: Connection[],
): Connection[] {
  const oldRows = new Map(before.connections.map((row) => [row.id, row]));
  const nextRows = new Map(after.connections.map((row) => [row.id, row]));
  return current.map((row) => {
    const old = oldRows.get(row.id),
      next = nextRows.get(row.id);
    if (!old || !next) return row;
    let merged = row;
    for (const field of fields) {
      if (sameActions(field, old[field], next[field])) continue;
      if (
        !sameActions(field, row[field], old[field]) &&
        !sameActions(field, row[field], next[field])
      )
        fail();
      merged = { ...merged, [field]: next[field] };
    }
    return merged;
  });
}
