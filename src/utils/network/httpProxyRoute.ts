import type { ProxyConfig } from "../../types/settings/settings";

const INVALID_PROXY =
  "The configured HTTP upstream proxy is invalid or unsupported. The configured route will not be bypassed.";

export class HttpNetworkRouteError extends Error {}

/** Secret-bearing, attempt-local URL. Never include this value in saved state or errors. */
export function httpProxyUrl(proxy: ProxyConfig): string {
  const scheme = proxy.type === "http-connect" ? "http" : proxy.type;
  const host = proxy.host?.trim();
  const port = Number(proxy.port);
  if (
    (scheme !== "http" && scheme !== "https") ||
    !host ||
    /[\s/@\\?#]/u.test(host) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new HttpNetworkRouteError(INVALID_PROXY);
  const username = proxy.username?.trim();
  const password = proxy.password ?? "";
  const auth = username
    ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@`
    : "";
  const authority =
    host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return canonicalHttpProxyUrl(`${scheme}://${auth}${authority}:${port}`);
}

export function canonicalHttpProxyUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      value !== value.trim() ||
      !["http:", "https:"].includes(url.protocol) ||
      !url.hostname ||
      url.port === "0" ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(INVALID_PROXY);
    return url.href;
  } catch {
    throw new HttpNetworkRouteError(INVALID_PROXY);
  }
}

/** The HTTP backend has one upstream slot, not a global + local proxy chain. */
export function mergeHttpProxyRoutes(
  local?: string,
  global?: string,
): string | undefined {
  const localUrl =
    local === undefined ? undefined : canonicalHttpProxyUrl(local);
  const globalUrl =
    global === undefined ? undefined : canonicalHttpProxyUrl(global);
  if (localUrl && globalUrl && localUrl !== globalUrl)
    throw new HttpNetworkRouteError(
      "The enabled global proxy and this connection's proxy are different. The HTTP backend cannot chain them; disable one or select the same proxy. Neither route was bypassed.",
    );
  // Preserve the existing global URL representation for its existing consumers.
  return global ?? local;
}
