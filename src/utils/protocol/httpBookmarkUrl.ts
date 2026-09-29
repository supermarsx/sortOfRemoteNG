/** Resolve bookmarks as web navigation targets, never executable URLs.
 * Relative paths belong to the saved website origin, not its login path. */
export function resolveHttpBookmarkUrl(
  path: string,
  baseUrl: string,
  currentDocumentUrl?: string,
): string {
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
    const sessionPrefix = /^\/cpsess[0-9]+(?=\/|$)/;
    const bookmarkSession = url.pathname.match(sessionPrefix)?.[0];
    if (
      bookmarkSession &&
      currentDocumentUrl &&
      !currentDocumentUrl.includes("\\") &&
      !Array.from(currentDocumentUrl).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      )
    ) {
      try {
        const current = new URL(currentDocumentUrl);
        const currentSession = current.pathname.match(sessionPrefix)?.[0];
        if (
          currentSession &&
          current.origin === base.origin &&
          current.origin === url.origin &&
          !current.username &&
          !current.password
        ) {
          // Splice only the leading path segment; keep encoded suffixes intact.
          return (
            url.origin +
            currentSession +
            url.href.slice(url.origin.length + bookmarkSession.length)
          );
        }
      } catch {
        // Invalid current documents must not invalidate a saved bookmark.
      }
    }
    return url.href;
  } catch {
    return "";
  }
}
