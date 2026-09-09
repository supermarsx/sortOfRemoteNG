import type {
  BrowserScript,
  WebAutomationItem,
  WebAutomationLibrary,
  WebInteractionMacro,
  WebInteractionStep,
} from "../../types/recording/webAutomation";
import {
  AppDataJsonStore,
  containsLikelySecretText,
} from "../storage/appDataJsonStore";

export const WEB_AUTOMATION_STORE_KEY = "recording.web-automation.v1";
export const MAX_WEB_SCRIPT_BYTES = 64 * 1024;
export const MAX_WEB_MACRO_STEPS = 200;
export const EMPTY_WEB_AUTOMATION_LIBRARY: WebAutomationLibrary = {
  version: 1,
  scripts: [],
  macros: [],
};
// Positional selectors never copy IDs/names/attribute values or page text.
export const WEB_POSITIONAL_SELECTOR =
  /^html > body(?: > [a-z][a-z0-9-]{0,30}:nth-of-type\([1-9][0-9]{0,3}\)){1,24}$/;

function record(
  value: unknown,
  allowed: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new Error(
      "Invalid website automation data. Review the library; it has not been reset.",
    );
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!allowEmpty && !value.trim()) ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    })
  )
    throw new Error(
      "Website automation text is missing, invalid, or too long.",
    );
  return value;
}
export function normalizeWebInteractionStep(
  value: unknown,
): WebInteractionStep {
  const raw = record(value, ["kind", "selector", "checked"]);
  const selector = text(raw.selector, 512);
  if (!WEB_POSITIONAL_SELECTOR.test(selector))
    throw new Error(
      "The recorded target is not a bounded structural selector.",
    );
  if (raw.kind === "check" && typeof raw.checked === "boolean")
    return { kind: "check", selector, checked: raw.checked };
  if (
    (raw.kind === "click" || raw.kind === "fill") &&
    raw.checked === undefined
  )
    return { kind: raw.kind, selector };
  throw new Error(
    "Invalid website macro step; input values and secret fields cannot be saved.",
  );
}
export function normalizeWebAutomationItem(value: unknown): WebAutomationItem {
  const raw = record(value, [
    "kind",
    "id",
    "name",
    "description",
    "createdAt",
    "updatedAt",
    "code",
    "steps",
  ]);
  const metadata = {
    id: text(raw.id, 128),
    name: text(raw.name, 100),
    description: text(raw.description, 1000, true),
    createdAt: text(raw.createdAt, 40),
    updatedAt: text(raw.updatedAt, 40),
  };
  if (
    !Number.isFinite(Date.parse(metadata.createdAt)) ||
    !Number.isFinite(Date.parse(metadata.updatedAt))
  )
    throw new Error("Website automation dates are invalid.");
  if (raw.kind === "script" && raw.steps === undefined) {
    const code = text(raw.code, MAX_WEB_SCRIPT_BYTES);
    if (new TextEncoder().encode(code).length > MAX_WEB_SCRIPT_BYTES)
      throw new Error("Website scripts are limited to 64 KiB.");
    if (containsLikelySecretText(code))
      throw new Error(
        "Do not save credential literals in website scripts. Enter sensitive information manually on the website.",
      );
    return { ...metadata, kind: "script", code };
  }
  if (
    raw.kind === "macro" &&
    raw.code === undefined &&
    Array.isArray(raw.steps) &&
    raw.steps.length > 0 &&
    raw.steps.length <= MAX_WEB_MACRO_STEPS
  )
    return {
      ...metadata,
      kind: "macro",
      steps: raw.steps.map(normalizeWebInteractionStep),
    };
  throw new Error(
    "Invalid website automation item or macro step limit exceeded.",
  );
}
export function normalizeWebAutomationLibrary(
  value: unknown,
): WebAutomationLibrary {
  const raw = record(value, ["version", "scripts", "macros"]);
  if (
    raw.version !== 1 ||
    !Array.isArray(raw.scripts) ||
    !Array.isArray(raw.macros) ||
    raw.scripts.length > 128 ||
    raw.macros.length > 128 ||
    new TextEncoder().encode(JSON.stringify(raw)).length > 2 * 1024 * 1024
  )
    throw new Error(
      "Unsupported or oversized website automation library (maximum 128 scripts, 128 macros, 2 MiB).",
    );
  const scripts = raw.scripts.map(normalizeWebAutomationItem),
    macros = raw.macros.map(normalizeWebAutomationItem);
  if (
    scripts.some((item) => item.kind !== "script") ||
    macros.some((item) => item.kind !== "macro") ||
    new Set([...scripts, ...macros].map((item) => item.id)).size !==
      scripts.length + macros.length
  )
    throw new Error(
      "Duplicate or incorrectly categorized website automation items.",
    );
  return {
    version: 1,
    scripts: scripts as BrowserScript[],
    macros: macros as WebInteractionMacro[],
  };
}

export const webAutomationStore = new AppDataJsonStore<WebAutomationLibrary>({
  key: WEB_AUTOMATION_STORE_KEY,
  backend: "macro-library",
  requireNative: true,
  sanitize(value) {
    const normalized = normalizeWebAutomationLibrary(value);
    return {
      value: normalized,
      changed: JSON.stringify(value) !== JSON.stringify(normalized),
    };
  },
});

/** Edit against the reviewed item, never overwrite a concurrent library edit. */
export async function saveWebAutomationItem(
  item: WebAutomationItem,
  expected?: WebAutomationItem,
  assertCurrent: () => void = () => {},
): Promise<WebAutomationLibrary> {
  const validated = normalizeWebAutomationItem(item);
  const reviewed =
    expected === undefined ? undefined : normalizeWebAutomationItem(expected);
  const result = await webAutomationStore.update((current) => {
    assertCurrent();
    const library = current ?? EMPTY_WEB_AUTOMATION_LIBRARY;
    const existing = [...library.scripts, ...library.macros].find(
      (candidate) => candidate.id === validated.id,
    );
    if (JSON.stringify(existing) !== JSON.stringify(reviewed))
      throw new Error(
        "This library item changed. Reload and review before saving.",
      );
    return normalizeWebAutomationLibrary({
      version: 1,
      scripts: [
        ...library.scripts.filter((candidate) => candidate.id !== validated.id),
        ...(validated.kind === "script" ? [validated] : []),
      ],
      macros: [
        ...library.macros.filter((candidate) => candidate.id !== validated.id),
        ...(validated.kind === "macro" ? [validated] : []),
      ],
    });
  });
  assertCurrent();
  return result.value;
}

export async function deleteWebAutomationItem(
  expected: WebAutomationItem,
  assertCurrent: () => void = () => {},
): Promise<WebAutomationLibrary> {
  const reviewed = normalizeWebAutomationItem(expected);
  const result = await webAutomationStore.update((current) => {
    assertCurrent();
    const library = current ?? EMPTY_WEB_AUTOMATION_LIBRARY;
    const existing = [...library.scripts, ...library.macros].find(
      (candidate) => candidate.id === expected.id,
    );
    if (JSON.stringify(existing) !== JSON.stringify(reviewed))
      throw new Error(
        "This library item changed. Reload and review before deleting.",
      );
    return {
      version: 1,
      scripts: library.scripts.filter((item) => item.id !== expected.id),
      macros: library.macros.filter((item) => item.id !== expected.id),
    };
  });
  assertCurrent();
  return result.value;
}
