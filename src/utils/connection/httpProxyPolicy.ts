import {
  DEFAULT_HTTP_PROXY_POLICY,
  DEFAULT_EXTERNAL_FONT_ORIGINS,
  DEFAULT_EXTERNAL_RESOURCE_ORIGINS,
  type HttpExternalResourceOrigin,
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

/** Validate before URL parsing so URL repairs cannot broaden an origin grant. */
export function normalizeExternalFontOrigins(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) return invalid();
  const seen = new Set<string>();
  return value.map((entry) => {
    if (
      typeof entry !== "string" ||
      bytes(entry) > 2048 ||
      hasControl(entry) ||
      /[\\*]/.test(entry)
    )
      return invalid();
    const trimmed = entry.trim();
    if (!/^https:\/\/[^/?#@\s]+\/?$/i.test(trimmed)) return invalid();
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return invalid();
    }
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.hostname.includes("*") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      seen.has(url.origin)
    )
      return invalid();
    seen.add(url.origin);
    return url.origin;
  });
}

export function normalizeExternalResourceOrigins(
  value: unknown,
): HttpExternalResourceOrigin[] {
  if (value === undefined)
    return DEFAULT_EXTERNAL_RESOURCE_ORIGINS.map((row) => ({
      origin: row.origin,
      kinds: [...row.kinds],
    }));
  if (!Array.isArray(value) || value.length > 16) return invalid();
  const origins = normalizeExternalFontOrigins(
    value.map((row) => {
      if (
        !object(row) ||
        Object.keys(row).some((key) => !["origin", "kinds"].includes(key))
      )
        return invalid();
      return row.origin;
    }),
  );
  return value.map((row, index) => {
    if (
      !Array.isArray(row.kinds) ||
      row.kinds.length < 1 ||
      row.kinds.length > 2 ||
      new Set(row.kinds).size !== row.kinds.length ||
      row.kinds.some(
        (kind: unknown) => kind !== "script" && kind !== "stylesheet",
      )
    )
      return invalid();
    return { origin: origins[index], kinds: [...row.kinds] };
  });
}

/** Absent legacy policy uses defaults; present malformed state is never repaired silently. */
export function normalizeHttpProxyPolicy(value: unknown): HttpProxyPolicy {
  if (value === undefined)
    return {
      ...DEFAULT_HTTP_PROXY_POLICY,
      queryParameters: [],
      externalFontOrigins: [...DEFAULT_EXTERNAL_FONT_ORIGINS],
      externalResourceOrigins: normalizeExternalResourceOrigins(undefined),
    };
  if (
    !object(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "version",
          "pageScripts",
          "httpsOnly",
          "sameOriginOnly",
          "allowExternalFonts",
          "externalFontOrigins",
          "externalResourceOrigins",
          "allowCrossOriginRedirects",
          "allowHttpDowngradeRedirects",
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
    (value.allowExternalFonts !== undefined &&
      typeof value.allowExternalFonts !== "boolean") ||
    (value.allowCrossOriginRedirects !== undefined &&
      typeof value.allowCrossOriginRedirects !== "boolean") ||
    (value.allowHttpDowngradeRedirects !== undefined &&
      typeof value.allowHttpDowngradeRedirects !== "boolean") ||
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
    allowExternalFonts:
      value.allowExternalFonts === undefined ||
      value.allowExternalFonts === true,
    externalFontOrigins: normalizeExternalFontOrigins(
      value.externalFontOrigins === undefined
        ? [...DEFAULT_EXTERNAL_FONT_ORIGINS]
        : value.externalFontOrigins,
    ),
    externalResourceOrigins: normalizeExternalResourceOrigins(
      value.externalResourceOrigins,
    ),
    allowCrossOriginRedirects: value.allowCrossOriginRedirects === true,
    allowHttpDowngradeRedirects: value.allowHttpDowngradeRedirects === true,
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
