/**
 * Hostname sanitiser (P8).
 *
 * A user who pastes `http://example.com` into the connection
 * editor's Hostname/IP field used to land their connection with
 * `hostname = "http://example.com"`. Then `buildTargetUrl` in
 * `useWebBrowser.ts` would produce
 * `http://http://example.com/` — invalid URL, navigation breaks,
 * no themed error to recover from.
 *
 * This module strips a leading scheme prefix from a hostname
 * string in two contexts:
 *
 * 1. **At input time** in the connection editor, so the field
 *    transparently normalises and the user sees the cleaned host
 *    rather than the raw paste.
 * 2. **At URL-build time** as a defensive belt-and-braces strip,
 *    so existing connections (and importer rows from
 *    mRemoteNG / RoyalTS / .rdp files that put URLs in the host
 *    field) don't break either.
 *
 * Scheme list covers every protocol the app recognises plus
 * generic placeholders (`ftp`, `mailto`, `tel`) people sometimes
 * paste by mistake. The check is case-insensitive — `HTTP://x`
 * gets stripped the same as `http://x`.
 *
 * Path / port suffixes inside a scheme-prefixed value are
 * REMOVED too (only the host remains), with the removed parts
 * surfaced in the result so the caller can decide whether to
 * apply them elsewhere (e.g. extract `:8080` to the Port field).
 * Bare `host:port` (no scheme) is left untouched — that
 * shape is valid for hostname fields in some configs.
 */

/**
 * Schemes the sanitiser recognises as "you probably pasted a URL".
 * Case-insensitive match. The trailing `://` is implied — we look
 * for `<scheme>://` literally.
 */
const KNOWN_SCHEMES = [
  // Web
  "http",
  "https",
  // Remote-desktop / shell
  "ssh",
  "sftp",
  "scp",
  "telnet",
  "rdp",
  "vnc",
  "spice",
  "xdmcp",
  "x2go",
  "nx",
  "rlogin",
  "ftp",
  "ftps",
  // App-internal / paste mistakes worth catching
  "smb",
  "cifs",
  "mysql",
  "postgres",
  "postgresql",
  "redis",
  "mongodb",
  "ws",
  "wss",
] as const;

/** Pre-compiled `scheme://` matcher. */
const SCHEME_PREFIX_RE = new RegExp(
  `^\\s*(${KNOWN_SCHEMES.join("|")})://`,
  "i",
);

/**
 * What the sanitiser found and did. `hostname` is always set (the
 * cleaned value); the other fields describe what got stripped so
 * the caller can act on them (e.g. surface a toast, or write the
 * extracted port to the port field).
 */
export interface SanitizedHostname {
  /** The cleaned hostname — never has a scheme prefix, never has
   *  a path / query / fragment. May still carry a `:<port>` if the
   *  input had one AND no scheme was detected. */
  hostname: string;
  /** True when a scheme was found and stripped. */
  stripped: boolean;
  /** The scheme that was stripped (lower-cased), if any. */
  scheme?: string;
  /** Port extracted from a scheme-prefixed input (e.g. the `8443`
   *  in `https://x:8443`). Caller decides whether to use it. */
  port?: number;
  /** Path / query / fragment that was discarded after the host. */
  path?: string;
}

/**
 * Strip a leading scheme prefix from `raw` if present and return a
 * structured result. Idempotent: calling twice yields the same
 * value as calling once.
 */
export function sanitizeHostname(raw: string): SanitizedHostname {
  if (!raw) {
    return { hostname: "", stripped: false };
  }
  const trimmed = raw.trim();
  const match = trimmed.match(SCHEME_PREFIX_RE);
  if (!match) {
    return { hostname: trimmed, stripped: false };
  }
  const scheme = match[1].toLowerCase();
  // Strip the matched prefix; what remains may still carry
  // user@host:port/path?q#frag — peel it apart.
  let rest = trimmed.slice(match[0].length);

  // Drop any user-info prefix (`user[:password]@`) — that lives
  // in dedicated fields, not the hostname.
  const atIdx = rest.indexOf("@");
  if (atIdx >= 0) {
    rest = rest.slice(atIdx + 1);
  }

  // Path / query / fragment — note where they start.
  const pathStart = rest.search(/[/?#]/);
  let path: string | undefined;
  if (pathStart >= 0) {
    path = rest.slice(pathStart);
    rest = rest.slice(0, pathStart);
  }

  // Port — only when the input had an explicit scheme. (Without a
  // scheme we leave `host:port` alone since it's valid in some
  // configs.)
  let port: number | undefined;
  // Defensive: ipv6 literal `[::1]:8080` shape. Strip brackets for
  // the host but keep the port logic.
  if (rest.startsWith("[")) {
    const end = rest.indexOf("]");
    if (end > 0) {
      const ipv6 = rest.slice(1, end);
      const afterBracket = rest.slice(end + 1);
      const portMatch = afterBracket.match(/^:(\d+)$/);
      if (portMatch) {
        const p = Number(portMatch[1]);
        if (Number.isInteger(p) && p > 0 && p <= 65535) port = p;
      }
      rest = ipv6;
    }
  } else {
    const colonIdx = rest.lastIndexOf(":");
    if (colonIdx >= 0 && /^\d+$/.test(rest.slice(colonIdx + 1))) {
      const p = Number(rest.slice(colonIdx + 1));
      if (Number.isInteger(p) && p > 0 && p <= 65535) {
        port = p;
        rest = rest.slice(0, colonIdx);
      }
    }
  }

  return {
    hostname: rest,
    stripped: true,
    scheme,
    port,
    path,
  };
}

/**
 * One-liner for call sites that only need the cleaned hostname and
 * don't care about telemetry. Equivalent to
 * `sanitizeHostname(raw).hostname`. Idempotent.
 */
export function stripSchemePrefix(raw: string): string {
  return sanitizeHostname(raw).hostname;
}
