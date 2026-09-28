/** Resolve bookmarks as web navigation targets, never executable URLs.
 * Relative paths belong to the saved website origin, not its login path. */
export function resolveHttpBookmarkUrl(path: string, baseUrl: string): string {
  const value = path.trim();
  if (
    !value ||
    value.includes("\\") ||
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return "";
  try {
    const base = new URL(baseUrl);
    const url = new URL(value, `${base.origin}/`);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    return url.href;
  } catch {
    return "";
  }
}
