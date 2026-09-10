import type { HttpFormAutomation } from "../../types/connection/httpFormAutomation";

export const DEFAULT_HTTP_FORM_AUTOMATION: Readonly<HttpFormAutomation> =
  Object.freeze({
    version: 1,
    fillDelayMs: 0,
    submitDelayMs: 0,
    detectionTimeoutMs: 8000,
    submit: true,
    fields: [],
  });
const invalid = () =>
  new Error(
    "Invalid advanced form settings. Review selectors, timing and additional fields before connecting.",
  );
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
};
function selector(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 512 ||
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw invalid();
  if (typeof document !== "undefined") {
    try {
      document.createDocumentFragment().querySelector(value);
    } catch {
      throw invalid();
    }
  }
  return value;
}

/** Strict and secret-safe: errors never interpolate selectors or field values. */
export function normalizeHttpFormAutomation(
  value: unknown,
): HttpFormAutomation | undefined {
  if (value === undefined) return undefined;
  const raw = record(value);
  if (
    Object.keys(raw).some(
      (key) =>
        ![
          "version",
          "formSelector",
          "fillDelayMs",
          "submitDelayMs",
          "detectionTimeoutMs",
          "submit",
          "fields",
        ].includes(key),
    ) ||
    raw.version !== 1 ||
    typeof raw.submit !== "boolean"
  )
    throw invalid();
  const number = (key: string, min: number, max: number) => {
    const candidate = raw[key];
    if (
      typeof candidate !== "number" ||
      !Number.isInteger(candidate) ||
      candidate < min ||
      candidate > max
    )
      throw invalid();
    return candidate;
  };
  const fillDelayMs = number("fillDelayMs", 0, 30000);
  const submitDelayMs = number("submitDelayMs", 0, 30000);
  const detectionTimeoutMs = number("detectionTimeoutMs", 1000, 60000);
  if (
    detectionTimeoutMs < fillDelayMs + submitDelayMs ||
    !Array.isArray(raw.fields) ||
    raw.fields.length > 16
  )
    throw invalid();
  const seen = new Set<string>();
  let bytes = 0;
  const fields = raw.fields.map((candidate) => {
    const field = record(candidate);
    if (Object.keys(field).some((key) => key !== "selector" && key !== "value"))
      throw invalid();
    const target = selector(field.selector);
    if (
      seen.has(target) ||
      typeof field.value !== "string" ||
      field.value.length > 4096 ||
      field.value.includes("\0")
    )
      throw invalid();
    seen.add(target);
    bytes += new TextEncoder().encode(field.value).byteLength;
    if (bytes > 16384) throw invalid();
    return { selector: target, value: field.value };
  });
  return {
    version: 1,
    ...(raw.formSelector === undefined
      ? {}
      : { formSelector: selector(raw.formSelector) }),
    fillDelayMs,
    submitDelayMs,
    detectionTimeoutMs,
    submit: raw.submit,
    fields,
  };
}
