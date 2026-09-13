export const MAX_TRUST_DESCRIPTION_BYTES = 4096;

/** Preserve ordinary prose; reject malformed or oversized native/imported text. */
export function validateTrustDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    new TextEncoder().encode(value).length > MAX_TRUST_DESCRIPTION_BYTES
  )
    throw new Error(
      "Identity descriptions must be text of at most 4096 UTF-8 bytes, without NUL characters.",
    );
  return value;
}

export function normalizeTrustMetadata(tags: string[], description: string) {
  const normalized = [
    ...new Set(tags.map((tag) => tag.trim()).filter(Boolean)),
  ];
  if (
    normalized.length > 100 ||
    normalized.some(
      (tag) =>
        tag.length > 128 ||
        tag.includes("\0") ||
        new TextEncoder().encode(tag).length > 256,
    )
  )
    throw new Error(
      "Use at most 100 tags, each at most 128 characters and 256 UTF-8 bytes.",
    );
  return {
    tags: normalized,
    description: validateTrustDescription(description) || null,
  };
}
