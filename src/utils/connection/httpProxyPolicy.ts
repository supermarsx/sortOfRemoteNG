import {
  DEFAULT_HTTP_PROXY_POLICY,
  type HttpProxyPolicy,
} from "../../types/connection/httpProxyPolicy";

const bytes = (value: string) => new TextEncoder().encode(value).length;
const hasControl = (value: string) =>
  Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const invalid = (): never => {
  throw new Error(
    "Invalid HTTP proxy policy. Review the advanced connection settings.",
  );
};

/** Absent legacy policy uses defaults; present malformed state is never repaired silently. */
export function normalizeHttpProxyPolicy(value: unknown): HttpProxyPolicy {
  if (value === undefined)
    return { ...DEFAULT_HTTP_PROXY_POLICY, queryParameters: [] };
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "version",
          "pageScripts",
          "httpsOnly",
          "sameOriginOnly",
          "cacheMode",
          "queryParameters",
        ].includes(key),
    )
  )
    return invalid();
  if (
    value.version !== 1 ||
    typeof value.pageScripts !== "string" ||
    !["allow", "inline-only", "block"].includes(value.pageScripts) ||
    typeof value.httpsOnly !== "boolean" ||
    typeof value.sameOriginOnly !== "boolean" ||
    typeof value.cacheMode !== "string" ||
    !["normal", "bypass"].includes(value.cacheMode) ||
    !Array.isArray(value.queryParameters) ||
    value.queryParameters.length > 16
  )
    return invalid();
  const seen = new Set<string>();
  let total = 0;
  const queryParameters = value.queryParameters.map((entry) => {
    if (
      !object(entry) ||
      Object.keys(entry).some((key) => key !== "name" && key !== "value") ||
      typeof entry.name !== "string" ||
      typeof entry.value !== "string" ||
      !/^[A-Za-z0-9_.~-]{1,128}$/.test(entry.name) ||
      entry.name.toLowerCase().startsWith("__sorng") ||
      entry.name.toLowerCase().startsWith("__sortofremoteng") ||
      hasControl(entry.value) ||
      bytes(entry.value) > 4096 ||
      seen.has(entry.name)
    )
      return invalid();
    seen.add(entry.name);
    total += bytes(entry.name) + bytes(entry.value);
    if (total > 16_384) return invalid();
    return { name: entry.name, value: entry.value };
  });
  return {
    version: 1,
    pageScripts: value.pageScripts as HttpProxyPolicy["pageScripts"],
    httpsOnly: value.httpsOnly,
    sameOriginOnly: value.sameOriginOnly,
    cacheMode: value.cacheMode as HttpProxyPolicy["cacheMode"],
    queryParameters,
  };
}

/** Header authentication must be an explicit mode; routing/browser headers cannot be overridden. */
export function validateHttpCustomHeaders(
  value: unknown,
  authMode: string,
): Record<string, string> {
  if (value === undefined) return {};
  const fail = (): never => {
    throw new Error(
      "Invalid or restricted custom HTTP headers. Review header authentication settings.",
    );
  };
  if (!object(value) || Object.keys(value).length > 32) return fail();
  const result: Record<string, string> = {};
  const seen = new Set<string>();
  let total = 0;
  for (const [name, content] of Object.entries(value)) {
    const lower = name.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) ||
      typeof content !== "string" ||
      hasControl(content) ||
      bytes(content) > 4096 ||
      seen.has(lower) ||
      [
        "host",
        "cookie",
        "origin",
        "referer",
        "connection",
        "proxy-authorization",
        "proxy-authenticate",
        "keep-alive",
        "transfer-encoding",
        "te",
        "trailer",
        "upgrade",
        "content-length",
        "accept-encoding",
      ].includes(lower) ||
      lower.startsWith("sec-") ||
      lower.startsWith("proxy-") ||
      lower.startsWith("x-forwarded-") ||
      lower === "forwarded" ||
      (/authorization|api[-_]?key|token|secret|password|credential/.test(
        lower,
      ) &&
        authMode !== "header")
    )
      return fail();
    total += bytes(name) + bytes(content);
    if (total > 16_384) return fail();
    seen.add(lower);
    result[name] = content;
  }
  return result;
}
