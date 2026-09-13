import type { TerminalMacro } from "../../types/recording/macroTypes";
import type { AutomationProvenance } from "../../types/recording/automationLibrary";
import {
  normalizeAutomationProvenanceMap,
  pruneAutomationProvenance,
} from "./automationProvenance";
import {
  AppDataJsonStore,
  type SanitizedValue,
} from "../storage/appDataJsonStore";
import { IndexedDbService } from "../storage/indexedDbService";
import {
  assertMacroLibraryReadAccess,
  type MacroLibraryReadAccess,
} from "../storage/macroLibraryReadRecovery";

const LEGACY_KEY = "mremote-terminal-macros";
export const TERMINAL_MACROS_STORE_KEY = "recording.terminal-macros";
export const MAX_TERMINAL_MACRO_STEPS = 100_000;
export const MAX_TERMINAL_MACRO_BYTES = 8 * 1024 * 1024;
interface MacroLibrary {
  version: 1;
  macros: TerminalMacro[];
  legacyDigest: string | null;
  provenance?: Record<string, AutomationProvenance>;
}

/** Commands are private library data, never copied into connection favorites. */
export function validateTerminalMacros(value: unknown): TerminalMacro[] {
  if (!Array.isArray(value) || value.length > 10_000)
    throw new Error(
      "Terminal macro library is invalid or too large; existing data was retained.",
    );
  const ids = new Set<string>();
  let total = 0;
  let totalSteps = 0;
  const text = (
    value: unknown,
    maximum: number,
    required = false,
  ): value is string =>
    typeof value === "string" &&
    value.length <= maximum &&
    (!required || value.length > 0) &&
    !value.includes("\0");
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      !text(item.id, 128, true) ||
      ids.has(item.id) ||
      !text(item.name, 256, true) ||
      !text(item.createdAt, 64, true) ||
      !text(item.updatedAt, 64, true) ||
      (item.description !== undefined && !text(item.description, 4096)) ||
      (item.category !== undefined && !text(item.category, 256)) ||
      (item.tags !== undefined &&
        (!Array.isArray(item.tags) ||
          item.tags.length > 64 ||
          !item.tags.every((tag: unknown) => text(tag, 128)))) ||
      !Array.isArray(item.steps) ||
      item.steps.length > 10_000
    )
      throw new Error(
        "A terminal macro is invalid; existing data was retained.",
      );
    ids.add(item.id);
    totalSteps += item.steps.length;
    if (totalSteps > MAX_TERMINAL_MACRO_STEPS)
      throw new Error(
        "Terminal macro library has too many steps; existing data was retained.",
      );
    for (const step of item.steps) {
      if (
        !step ||
        typeof step !== "object" ||
        !text(step.command, 65_536) ||
        !Number.isSafeInteger(step.delayMs) ||
        step.delayMs < 0 ||
        step.delayMs > 3_600_000 ||
        typeof step.sendNewline !== "boolean"
      )
        throw new Error(
          "A terminal macro step is invalid; existing data was retained.",
        );
      total += step.command.length;
    }
  }
  if (total > 4_194_304)
    throw new Error(
      "Terminal macro library is too large; existing data was retained.",
    );
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    MAX_TERMINAL_MACRO_BYTES
  )
    throw new Error(
      "Terminal macro library exceeds its metadata and command byte limit; existing data was retained.",
    );
  return structuredClone(value as TerminalMacro[]);
}

function sanitize(value: unknown): SanitizedValue<MacroLibrary> {
  const library = value as MacroLibrary;
  if (
    !library ||
    library.version !== 1 ||
    (library.legacyDigest !== null &&
      !/^[a-f0-9]{64}$/.test(library.legacyDigest))
  )
    throw new Error(
      "Protected terminal macro library is invalid; existing data was retained.",
    );
  return {
    value: {
      version: 1,
      macros: validateTerminalMacros(library.macros),
      legacyDigest: library.legacyDigest,
      ...(library.provenance === undefined
        ? {}
        : { provenance: normalizeAutomationProvenanceMap(library.provenance) }),
    },
    changed: false,
  };
}

export const terminalMacrosStore = new AppDataJsonStore<MacroLibrary>({
  key: TERMINAL_MACROS_STORE_KEY,
  // IndexedDB migration below owns the legacy key and its verified cleanup.
  requireNative: true,
  backend: "macro-library",
  sanitize,
});

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Verified create-if-absent migration; a later legacy writer cannot resurrect removed macros. */
export async function loadTerminalMacros(
  access?: MacroLibraryReadAccess,
): Promise<TerminalMacro[]> {
  assertMacroLibraryReadAccess(access);
  const durable = await terminalMacrosStore.load(access);
  assertMacroLibraryReadAccess(access);
  const indexed = await IndexedDbService.getItemStrict<unknown>(LEGACY_KEY);
  assertMacroLibraryReadAccess(access);
  const localRaw =
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(LEGACY_KEY);
  let local: unknown = null;
  if (localRaw !== null) {
    try {
      local = JSON.parse(localRaw);
    } catch {
      throw new Error(
        "Legacy terminal macros are malformed; the original was retained.",
      );
    }
  }
  if (
    indexed !== null &&
    local !== null &&
    JSON.stringify(indexed) !== JSON.stringify(local)
  )
    throw new Error(
      "Legacy terminal macro copies disagree. Both originals were retained.",
    );
  const legacy = indexed ?? local;
  if (durable.value && legacy === null) return durable.value.macros;
  const legacyMacros = legacy === null ? [] : validateTerminalMacros(legacy);
  const legacyDigest = legacy === null ? null : await digest(legacy);
  assertMacroLibraryReadAccess(access);
  const verified =
    durable.value ??
    (
      await terminalMacrosStore.update((current) => {
        assertMacroLibraryReadAccess(access);
        return current ?? { version: 1, macros: legacyMacros, legacyDigest };
      }, access)
    ).value;
  assertMacroLibraryReadAccess(access);
  if (legacy !== null) {
    if (verified.legacyDigest !== legacyDigest)
      throw new Error(
        "Legacy terminal macros changed after migration. Originals were retained; they were not reimported.",
      );
    // Read-back succeeds before the first removal; native refusal/lock/drift
    // retains both old sources. The IndexedDB compare/delete is one transaction.
    const readback = await terminalMacrosStore.load(access, {
      recoverPreReadBusy: false,
    });
    assertMacroLibraryReadAccess(access);
    if (JSON.stringify(readback.value) !== JSON.stringify(verified))
      throw new Error(
        "Terminal macro migration could not be verified; originals were retained.",
      );
    if (
      typeof localStorage !== "undefined" &&
      localStorage.getItem(LEGACY_KEY) !== localRaw
    )
      throw new Error(
        "Legacy terminal macros changed during migration; originals were retained.",
      );
    await IndexedDbService.transactItemsStrict([LEGACY_KEY], (values) => {
      assertMacroLibraryReadAccess(access);
      if (JSON.stringify(values[LEGACY_KEY]) !== JSON.stringify(indexed))
        throw new Error(
          "Legacy terminal macros changed during migration; originals were retained.",
        );
      return {
        set: {},
        remove: indexed === null ? [] : [LEGACY_KEY],
        result: undefined,
      };
    });
    assertMacroLibraryReadAccess(access);
    if (localRaw !== null) {
      if (localStorage.getItem(LEGACY_KEY) !== localRaw)
        throw new Error(
          "A legacy local copy changed and was retained; protected migration is complete.",
        );
      localStorage.removeItem(LEGACY_KEY);
    }
  }
  return verified.macros;
}

export async function updateTerminalMacros(
  transform: (macros: TerminalMacro[]) => TerminalMacro[],
): Promise<void> {
  await loadTerminalMacros();
  await terminalMacrosStore.update((current) => {
    if (!current)
      throw new Error(
        "Terminal macro library disappeared; reload before editing.",
      );
    const macros = validateTerminalMacros(transform(current.macros));
    return {
      ...current,
      macros,
      ...(current.provenance === undefined
        ? {}
        : {
            provenance: pruneAutomationProvenance(current.provenance, {
              "terminal-macro": macros.map((item) => item.id),
            }),
          }),
    };
  });
}
