import type { AutomationProvenance } from "../../types/recording/automationLibrary";

const invalid = () =>
  new Error("Invalid automation provenance; existing metadata was retained.");
export const hasAutomationControlCharacters = (
  value: string,
  allowWhitespace = true,
) =>
  Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (
      code === 127 ||
      (code < 32 && (!allowWhitespace || ![9, 10, 13].includes(code)))
    );
  });
const fields = [
  "sourceId",
  "sourceUrl",
  "sourceSha256",
  "publisher",
  "license",
  "description",
  "platforms",
  "tags",
  "importedAt",
];
function boundedText(value: unknown, maximum: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximum ||
    hasAutomationControlCharacters(value)
  )
    throw invalid();
  return value;
}

/** Metadata never grants trust, changes execution context, or fetches a URL. */
export function normalizeAutomationProvenance(
  value: unknown,
): AutomationProvenance {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !fields.includes(key))
  )
    throw invalid();
  const raw = value as Record<string, unknown>;
  const result: AutomationProvenance = {};
  for (const field of [
    "sourceId",
    "publisher",
    "license",
    "description",
    "importedAt",
  ] as const) {
    if (raw[field] !== undefined)
      result[field] = boundedText(
        raw[field],
        field === "description" ? 4096 : 256,
      );
  }
  if (result.importedAt && !Number.isFinite(Date.parse(result.importedAt)))
    throw invalid();
  if (raw.sourceSha256 !== undefined) {
    if (
      typeof raw.sourceSha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(raw.sourceSha256)
    )
      throw invalid();
    result.sourceSha256 = raw.sourceSha256;
  }
  if (raw.sourceUrl !== undefined) {
    const source = boundedText(raw.sourceUrl, 2048);
    let url: URL;
    try {
      url = new URL(source);
    } catch {
      throw invalid();
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw invalid();
    result.sourceUrl = source;
  }
  for (const field of ["platforms", "tags"] as const) {
    if (raw[field] === undefined) continue;
    if (!Array.isArray(raw[field]) || raw[field].length > 64) throw invalid();
    result[field] = raw[field].map((item) => boundedText(item, 128));
  }
  return result;
}

export function normalizeAutomationProvenanceMap(
  value: unknown,
): Record<string, AutomationProvenance> {
  if (value === undefined) return {};
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 12000
  )
    throw invalid();
  const result: Record<string, AutomationProvenance> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      !/^(terminal-script|terminal-macro|website-script|website-macro):.{1,128}$/.test(
        key,
      ) ||
      hasAutomationControlCharacters(key, false)
    )
      throw invalid();
    result[key] = normalizeAutomationProvenance(entry);
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 256 * 1024)
    throw invalid();
  return result;
}

/** Only deliberate successful edits remove metadata for deleted items. */
export function pruneAutomationProvenance(
  value: Record<string, AutomationProvenance> | undefined,
  active: Partial<
    Record<
      "terminal-script" | "terminal-macro" | "website-script" | "website-macro",
      readonly string[]
    >
  >,
) {
  if (value === undefined) return undefined;
  const known = Object.fromEntries(
    Object.entries(active).map(([family, ids]) => [family, new Set(ids)]),
  );
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => {
      const colon = key.indexOf(":"),
        family = key.slice(0, colon);
      return !known[family] || known[family].has(key.slice(colon + 1));
    }),
  );
}
