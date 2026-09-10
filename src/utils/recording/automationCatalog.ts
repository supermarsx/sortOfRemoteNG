import type {
  ManagedScript,
  ScriptLanguage,
  OSTag,
} from "../../components/recording/scriptManager/shared";
import {
  languageLabels,
  OS_TAG_LABELS,
} from "../../components/recording/scriptManager/shared";
import type {
  AutomationEntry,
  AutomationFamily,
  AutomationLibraryApi,
  AutomationLibraryChange,
  AutomationLibrarySnapshot,
  AutomationProvenance,
} from "../../types/recording/automationLibrary";
import type {
  AutomationCatalogDocument,
  AutomationCatalogExport,
  AutomationCatalogItem,
  AutomationCatalogManifest,
  AutomationCatalogPreview,
  AutomationCatalogResolution,
  AutomationCatalogSource,
} from "../../types/recording/automationCatalog";
import { containsLikelySecretText } from "../storage/appDataJsonStore";
import { normalizeWebAutomationItem } from "./webAutomationLibrary";
import { validateTerminalMacros } from "./terminalMacroPersistence";
import { getInvoke } from "../tauri/invoke";
import {
  normalizeAutomationEntry,
  normalizeAutomationProvenance,
} from "./automationLibraryValidation";

export const MAX_AUTOMATION_CATALOG_BYTES = 2 * 1024 * 1024;
export const MAX_AUTOMATION_CATALOG_ITEMS = 128;
const MAX_SOURCE = 64 * 1024;
const FAMILIES: AutomationFamily[] = [
  "terminal-script",
  "terminal-macro",
  "website-script",
  "website-macro",
];
const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const invalid = () =>
  new Error(
    "Invalid automation manifest metadata or payload. No library was changed.",
  );
function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, empty = false): string {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (!empty && !value.trim()) ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code === 127 || (code < 32 && ![9, 10, 13].includes(code));
    })
  )
    throw invalid();
  return value;
}
function list(value: unknown, max = 32): string[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  const result = value.map((item) => text(item, 128));
  if (new Set(result).size !== result.length) throw invalid();
  return result;
}
function date(value: unknown): string {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw invalid();
  return result;
}
export function publicCatalogUrl(value: string): string {
  if (
    value.length > 2048 ||
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href.length > 2048 ||
    (url.port && url.port !== "443")
  )
    throw new Error(
      "Use a public HTTPS raw URL without credentials, query, fragment, or custom port.",
    );
  return url.href;
}
function sourceText(value: unknown): string {
  const source = text(value, MAX_SOURCE);
  if (bytes(source) > MAX_SOURCE)
    throw new Error(
      "Portable script and macro source is limited to 64 KiB per entry.",
    );
  if (containsLikelySecretText(source))
    throw new Error(
      "This entry appears to contain literal credentials. Remove sensitive values before importing or exporting.",
    );
  return source;
}
function provenance(value: unknown): AutomationProvenance {
  const result = normalizeAutomationProvenance(value);
  if (result.sourceUrl) result.sourceUrl = publicCatalogUrl(result.sourceUrl);
  return result;
}
function terminalScript(value: unknown): ManagedScript {
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
  const language = text(raw.language, 32);
  if (!Object.prototype.hasOwnProperty.call(languageLabels, language))
    throw invalid();
  const osTags = list(raw.osTags);
  if (
    osTags.some(
      (tag) => !Object.prototype.hasOwnProperty.call(OS_TAG_LABELS, tag),
    )
  )
    throw invalid();
  return {
    id: text(raw.id, 128),
    name: text(raw.name, 256),
    description: text(raw.description, 4096, true),
    script: sourceText(raw.script),
    language: language as ScriptLanguage,
    category: text(raw.category, 256, true),
    osTags: osTags as OSTag[],
    createdAt: date(raw.createdAt),
    updatedAt: date(raw.updatedAt),
  };
}
function item(value: unknown): AutomationCatalogItem {
  const raw = object(value, [
    "id",
    "kind",
    "description",
    "platforms",
    "tags",
    "license",
    "provenance",
    "payload",
  ]);
  const kind = raw.kind as AutomationFamily;
  if (!FAMILIES.includes(kind)) throw invalid();
  let payload;
  if (kind === "terminal-script") payload = terminalScript(raw.payload);
  else if (kind === "terminal-macro") {
    const macro = object(raw.payload, [
      "id",
      "name",
      "description",
      "category",
      "steps",
      "createdAt",
      "updatedAt",
      "tags",
    ]);
    if (!Array.isArray(macro.steps) || macro.steps.length > 200)
      throw new Error("Portable terminal macros are limited to 200 steps.");
    for (const step of macro.steps) {
      const entry = object(step, ["command", "delayMs", "sendNewline"]);
      // Empty command steps are legitimate delays; never add command text.
      const command = text(entry.command, MAX_SOURCE, true);
      if (bytes(command) > MAX_SOURCE || containsLikelySecretText(command))
        throw new Error(
          "Macro commands exceed the portable bound or contain likely literal credentials.",
        );
    }
    if (bytes(JSON.stringify(macro.steps)) > MAX_SOURCE)
      throw new Error("Portable macro steps are limited to 64 KiB.");
    date(macro.createdAt);
    date(macro.updatedAt);
    [payload] = validateTerminalMacros([macro]);
  } else {
    payload = normalizeWebAutomationItem(raw.payload);
    if (payload.kind !== (kind === "website-script" ? "script" : "macro"))
      throw invalid();
  }
  const id = text(raw.id, 128);
  if (id !== payload.id) throw invalid();
  // The portable reader must never accept a payload the destination rejects.
  normalizeAutomationEntry({ family: kind, payload });
  return {
    id,
    kind,
    description: text(raw.description, 4096, true),
    platforms: list(raw.platforms),
    payload,
    ...(raw.tags !== undefined ? { tags: list(raw.tags) } : {}),
    ...(raw.license !== undefined ? { license: text(raw.license, 256) } : {}),
    ...(raw.provenance !== undefined
      ? { provenance: provenance(raw.provenance) }
      : {}),
  } as AutomationCatalogItem;
}
export function parseAutomationCatalog(
  body: string,
): AutomationCatalogManifest {
  if (bytes(body) > MAX_AUTOMATION_CATALOG_BYTES)
    throw new Error("Automation manifests are limited to 2 MiB.");
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("Choose a valid UTF-8 JSON automation manifest.");
  }
  const raw = object(value, [
    "format",
    "version",
    "id",
    "name",
    "description",
    "publisher",
    "repository",
    "entries",
  ]);
  if (raw.format !== "sorng-automation-index" || raw.version !== 1)
    throw new Error("Unsupported automation manifest format or version.");
  if (
    !Array.isArray(raw.entries) ||
    raw.entries.length > MAX_AUTOMATION_CATALOG_ITEMS
  )
    throw new Error("Automation manifests are limited to 128 entries.");
  const entries = raw.entries.map(item);
  if (
    new Set(entries.map((entry) => `${entry.kind}:${entry.id}`)).size !==
    entries.length
  )
    throw new Error("Duplicate automation entry identifiers in manifest.");
  const manifest: AutomationCatalogManifest = {
    format: "sorng-automation-index",
    version: 1,
    id: text(raw.id, 128),
    name: text(raw.name, 256),
    description: text(raw.description, 4096, true),
    entries,
  };
  if (raw.publisher !== undefined) {
    const publisher = object(raw.publisher, ["name", "homepage"]);
    manifest.publisher = {
      name: text(publisher.name, 256),
      ...(publisher.homepage !== undefined
        ? { homepage: publicCatalogUrl(text(publisher.homepage, 4096)) }
        : {}),
    };
  }
  if (raw.repository !== undefined) {
    const repository = object(raw.repository, ["url", "ref", "path"]);
    const path = text(repository.path, 1024);
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((segment) => segment === ".." || segment === ".")
    )
      throw invalid();
    manifest.repository = {
      url: publicCatalogUrl(text(repository.url, 4096)),
      ref: text(repository.ref, 256),
      path,
    };
  }
  return manifest;
}
async function digest(body: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function catalogFromFile(
  body: string,
): Promise<AutomationCatalogDocument> {
  const manifest = parseAutomationCatalog(body);
  return {
    manifest,
    source: {
      kind: "file",
      sha256: await digest(body),
      fetchedAt: new Date().toISOString(),
    },
  };
}
export async function fetchAutomationCatalog(
  value: string,
): Promise<AutomationCatalogDocument> {
  const url = publicCatalogUrl(value);
  const invoke = await getInvoke();
  if (!invoke)
    throw new Error(
      "Public repository refresh requires the desktop app. You can import a reviewed JSON pack instead.",
    );
  const raw = object(await invoke("script_catalog_fetch", { url }), [
    "url",
    "body",
    "sha256",
    "fetchedAt",
  ]);
  if (raw.url !== url || typeof raw.body !== "string")
    throw new Error("The catalog response did not match the requested source.");
  const manifest = parseAutomationCatalog(raw.body);
  const sha256 = await digest(raw.body);
  if (raw.sha256 !== sha256)
    throw new Error("The catalog response integrity check failed.");
  return {
    manifest,
    source: { kind: "remote", url, sha256, fetchedAt: date(raw.fetchedAt) },
  };
}

const reviews = new WeakMap<
  AutomationCatalogPreview,
  { snapshot: AutomationLibrarySnapshot; entries: AutomationEntry[] }
>();
export function previewAutomationCatalog(
  document: AutomationCatalogDocument,
  ids: string[],
  snapshot: AutomationLibrarySnapshot,
): AutomationCatalogPreview {
  const selected = [...new Set(ids)];
  if (!selected.length) throw new Error("Select at least one entry to review.");
  const entries = selected.map((id): AutomationEntry => {
    const entry = document.manifest.entries.find(
      (entry) => entry.kind === snapshot.family && entry.id === id,
    );
    if (!entry)
      throw new Error("Review one matching automation kind at a time.");
    return normalizeAutomationEntry({
      family: entry.kind,
      payload: structuredClone(entry.payload),
      provenance: {
        ...entry.provenance,
        sourceId: document.manifest.id,
        sourceUrl: document.source.url,
        sourceSha256: document.source.sha256,
        publisher:
          document.manifest.publisher?.name ?? entry.provenance?.publisher,
        license: entry.license ?? entry.provenance?.license,
        description: entry.description.trim() ? entry.description : undefined,
        platforms: [...entry.platforms],
        tags: entry.tags ? [...entry.tags] : undefined,
        importedAt: new Date().toISOString(),
      },
    });
  });
  const captured = structuredClone(snapshot);
  const preview: AutomationCatalogPreview = {
    snapshot: structuredClone(snapshot),
    source: structuredClone(document.source),
    rows: entries.map((entry) => ({
      id: entry.payload.id,
      name: entry.payload.name,
      conflict: captured.entries.some(
        (current) => current.payload.id === entry.payload.id,
      ),
      canReplace:
        !entry.payload.id.startsWith("default-") &&
        captured.entries.some(
          (current) => current.payload.id === entry.payload.id,
        ),
    })),
  };
  reviews.set(preview, { snapshot: captured, entries });
  return preview;
}
export function discardAutomationCatalogPreview(
  preview: AutomationCatalogPreview,
): void {
  reviews.delete(preview);
}
export async function applyAutomationCatalogPreview(
  api: AutomationLibraryApi,
  preview: AutomationCatalogPreview,
  resolutions: Record<string, AutomationCatalogResolution>,
): Promise<AutomationLibrarySnapshot> {
  const review = reviews.get(preview);
  if (!review)
    throw new Error(
      "Import review expired. Review the source and destination again.",
    );
  const changes: AutomationLibraryChange[] = [];
  for (const entry of review.entries) {
    const resolution = resolutions[entry.payload.id];
    if (resolution === "skip") continue;
    if (resolution === "copy") {
      changes.push({
        operation: "put",
        entry: {
          ...structuredClone(entry),
          payload: {
            ...structuredClone(entry.payload),
            id: crypto.randomUUID(),
          },
        } as AutomationEntry,
      });
    } else if (resolution === "replace") {
      const expected = review.snapshot.entries.find(
        (current) => current.payload.id === entry.payload.id,
      );
      if (!expected || entry.payload.id.startsWith("default-"))
        throw new Error(
          "Replacement requires an existing reviewed custom entry. Import a copy instead.",
        );
      changes.push({
        operation: "put",
        entry: structuredClone(entry),
        expected: structuredClone(expected),
      });
    } else
      throw new Error(
        "Choose copy, skip, or explicit replacement for each selected entry.",
      );
  }
  const result = changes.length
    ? await api.apply(review.snapshot, changes)
    : review.snapshot;
  reviews.delete(preview);
  return result;
}
export function exportAutomationCatalog({
  name,
  entries,
}: AutomationCatalogExport): string {
  if (!entries.length) throw new Error("Select at least one entry to export.");
  const body = JSON.stringify({
    format: "sorng-automation-index",
    version: 1,
    id: crypto.randomUUID(),
    name,
    description: "Selected automation entries. Importing never executes them.",
    entries: entries.map((entry) => ({
      id: entry.payload.id,
      kind: entry.family,
      payload: entry.payload,
      description:
        entry.provenance?.description ?? entry.payload.description ?? "",
      platforms:
        entry.provenance?.platforms ??
        (entry.family === "terminal-script" ? entry.payload.osTags : []),
      ...(entry.provenance ? { provenance: entry.provenance } : {}),
    })),
  });
  parseAutomationCatalog(body);
  return body;
}
