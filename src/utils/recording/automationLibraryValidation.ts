import {
  OS_TAG_LABELS,
  languageLabels,
  type ManagedScript,
} from "../../components/recording/scriptManager/shared";
import type {
  AutomationEntry,
  DatabaseAutomationLibrary,
} from "../../types/recording/automationLibrary";
import { containsLikelySecretText } from "../storage/appDataJsonStore";
import { validateTerminalMacros } from "./terminalMacroPersistence";
import {
  normalizeWebAutomationItem,
  normalizeWebAutomationLibrary,
} from "./webAutomationLibrary";
import {
  normalizeAutomationProvenance,
  normalizeAutomationProvenanceMap,
  hasAutomationControlCharacters,
} from "./automationProvenance";

export { normalizeAutomationProvenance } from "./automationProvenance";
const invalid = () =>
  new Error(
    "Invalid or oversized automation library; existing data was retained.",
  );
function object(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, empty = false): string {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!empty && !value.trim()) ||
    hasAutomationControlCharacters(value)
  )
    throw invalid();
  return value;
}

export function normalizeManagedScript(value: unknown): ManagedScript {
  const raw = object(value, [
    "id",
    "name",
    "description",
    "script",
    "language",
    "category",
    "osTags",
    "createdAt",
    "updatedAt",
  ]);
  const script = text(raw.script, 65536, true);
  if (
    new TextEncoder().encode(script).length > 65536 ||
    containsLikelySecretText(script)
  )
    throw invalid();
  const languages = Object.keys(languageLabels);
  const platforms = Object.keys(OS_TAG_LABELS);
  if (
    !languages.includes(String(raw.language)) ||
    !Array.isArray(raw.osTags) ||
    raw.osTags.length > platforms.length ||
    !raw.osTags.every(
      (tag) => typeof tag === "string" && platforms.includes(tag),
    )
  )
    throw invalid();
  const result = {
    id: text(raw.id, 128),
    name: text(raw.name, 256),
    description: text(raw.description, 4096, true),
    script,
    language: raw.language as ManagedScript["language"],
    category: text(raw.category, 256, true),
    osTags: [...raw.osTags] as ManagedScript["osTags"],
    createdAt: text(raw.createdAt, 64),
    updatedAt: text(raw.updatedAt, 64),
  };
  if (
    !Number.isFinite(Date.parse(result.createdAt)) ||
    !Number.isFinite(Date.parse(result.updatedAt))
  )
    throw invalid();
  return result;
}

export function normalizeAutomationEntry(value: unknown): AutomationEntry {
  const raw = object(value, ["family", "payload", "provenance"]);
  const provenance =
    raw.provenance === undefined
      ? {}
      : { provenance: normalizeAutomationProvenance(raw.provenance) };
  if (raw.family === "terminal-script")
    return {
      family: raw.family,
      payload: normalizeManagedScript(raw.payload),
      ...provenance,
    };
  if (raw.family === "terminal-macro") {
    const macro = object(raw.payload, [
      "id",
      "name",
      "description",
      "category",
      "tags",
      "steps",
      "createdAt",
      "updatedAt",
    ]);
    if (!Array.isArray(macro.steps)) throw invalid();
    for (const step of macro.steps)
      object(step, ["command", "delayMs", "sendNewline"]);
    return {
      family: raw.family,
      payload: validateTerminalMacros([macro])[0],
      ...provenance,
    };
  }
  if (raw.family === "website-script" || raw.family === "website-macro") {
    const payload = normalizeWebAutomationItem(raw.payload);
    if (raw.family === "website-script" && payload.kind === "script")
      return { family: raw.family, payload, ...provenance };
    if (raw.family === "website-macro" && payload.kind === "macro")
      return { family: raw.family, payload, ...provenance };
  }
  throw invalid();
}

export function emptyDatabaseAutomationLibrary(): DatabaseAutomationLibrary {
  return {
    version: 1,
    revision: 0,
    terminalScripts: {
      customScripts: [],
      modifiedDefaults: [],
      deletedDefaultIds: [],
    },
    terminalMacros: [],
    website: { version: 1, scripts: [], macros: [] },
    provenance: {},
  };
}

/** Missing legacy field is empty; malformed PRESENT content is never reset. */
export function normalizeDatabaseAutomationLibrary(
  value: unknown,
): DatabaseAutomationLibrary {
  if (value === undefined) return emptyDatabaseAutomationLibrary();
  const raw = object(value, [
    "version",
    "revision",
    "terminalScripts",
    "terminalMacros",
    "website",
    "provenance",
  ]);
  if (
    raw.version !== 1 ||
    !Number.isSafeInteger(raw.revision) ||
    (raw.revision as number) < 0 ||
    new TextEncoder().encode(JSON.stringify(raw)).length > 16 * 1024 * 1024
  )
    throw invalid();
  const scripts = object(raw.terminalScripts, [
    "customScripts",
    "modifiedDefaults",
    "deletedDefaultIds",
  ]);
  if (
    !Array.isArray(scripts.customScripts) ||
    !Array.isArray(scripts.modifiedDefaults) ||
    !Array.isArray(scripts.deletedDefaultIds) ||
    scripts.customScripts.length + scripts.modifiedDefaults.length > 1024 ||
    scripts.deletedDefaultIds.length > 1024
  )
    throw invalid();
  const customScripts = scripts.customScripts.map(normalizeManagedScript),
    modifiedDefaults = scripts.modifiedDefaults.map(normalizeManagedScript);
  const ids = [...customScripts, ...modifiedDefaults].map((entry) => entry.id);
  const deletedDefaultIds = scripts.deletedDefaultIds.map((id) =>
    text(id, 128),
  );
  if (
    new Set(ids).size !== ids.length ||
    new Set(deletedDefaultIds).size !== deletedDefaultIds.length ||
    modifiedDefaults.some((entry) => deletedDefaultIds.includes(entry.id)) ||
    new TextEncoder().encode(JSON.stringify(scripts)).length > 4 * 1024 * 1024
  )
    throw invalid();
  const terminalMacros = validateTerminalMacros(raw.terminalMacros);
  for (const payload of terminalMacros)
    normalizeAutomationEntry({ family: "terminal-macro", payload });
  return {
    version: 1,
    revision: raw.revision as number,
    terminalScripts: { customScripts, modifiedDefaults, deletedDefaultIds },
    terminalMacros,
    website: normalizeWebAutomationLibrary(raw.website),
    provenance: normalizeAutomationProvenanceMap(raw.provenance),
  };
}
