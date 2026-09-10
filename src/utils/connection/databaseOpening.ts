/** Only cancellation/access revocation is informational; wrong credentials and
 * damaged storage remain failures. Never place backend text in a loading toast. */
export function isDatabaseOpenCancellation(error: unknown): boolean {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "AbortError"
  )
    return true;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return (
    /\b(?:cancelled|canceled)\b/i.test(message) ||
    /(?:database unlock request is no longer active|database access (?:expired|is suspended|is no longer unlocked)|database.*(?:was locked|is locked)|global.*(?:was locked|is locked))/i.test(
      message,
    )
  );
}
