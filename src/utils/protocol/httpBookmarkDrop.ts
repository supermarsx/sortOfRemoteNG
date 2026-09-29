import type { HttpBookmarkItem } from "../../types/connection/connection";
import {
  googleUpstreamForProxy,
  type GoogleProxyRoute,
} from "./googleProxySession";
import { resolveHttpBookmarkUrl } from "./httpBookmarkUrl";

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_URLS = 32;
const protectedAlias = /^p[0-9a-f]{32}\.localhost\.?$/i;
const navigationKeys = new Set([
  "__sorng_navigation_v1",
  "__sorng_generation_v1",
]);

function absoluteWebUrl(value: string): URL | undefined {
  // Reject controls before trimming: URL parsing silently discards some of them.
  if (
    Array.from(value).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    )
  )
    return undefined;
  const candidate = value.trim();
  if (!/^https?:\/\/[^/\\]/i.test(candidate) || /[\s<>"]/.test(candidate))
    return undefined;
  const resolved = resolveHttpBookmarkUrl(candidate, candidate);
  return resolved ? new URL(resolved) : undefined;
}

function internalPath(url: URL): boolean {
  // Native handlers in http.rs reserve /__sortofremoteng_* (assets,
  // autologin, cookie bridge, etc.); also reserve the short internal prefix.
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Fail closed when malformed escapes prevent inspecting the endpoint.
    return true;
  }
  return /^\/+__(?:sorng|sortofremoteng)/i.test(path);
}

/** Parse browser link drops only. Context must come from the active native session. */
export function readHttpBookmarkDrop(
  data: Pick<DataTransfer, "getData">,
  context?: {
    proxyOrigin?: string;
    upstreamUrl?: string;
    routes?: readonly GoogleProxyRoute[];
  },
): HttpBookmarkItem[] {
  const uriList = data.getData("text/uri-list");
  const raw = uriList || data.getData("text/plain");
  if (
    raw.length > MAX_INPUT_BYTES ||
    new TextEncoder().encode(raw).byteLength > MAX_INPUT_BYTES
  )
    return [];

  const candidates = uriList ? raw.split(/\r?\n/) : [raw];
  const urls = new Set<string>();
  for (const candidate of candidates) {
    if (urls.size >= MAX_URLS) break;
    if (uriList && (!candidate.trim() || candidate.trim().startsWith("#")))
      continue;
    let url = absoluteWebUrl(candidate);
    if (!url || internalPath(url)) continue;

    const routes = context?.routes ?? [];
    const origin = url.origin;
    const route = routes.find((entry) => entry.proxyOrigin === origin);
    // Resource aliases must not fall through to the current-origin mapping.
    if (route && !route.documents) continue;
    const googleUrl = googleUpstreamForProxy(routes, url);
    let projected = false;
    if (googleUrl !== undefined) {
      url = absoluteWebUrl(googleUrl);
      if (!url) continue;
      projected = true;
    } else if (context?.proxyOrigin === url.origin) {
      const upstream = absoluteWebUrl(context.upstreamUrl ?? "");
      if (!upstream) continue;
      // Assign URL components rather than resolving a possibly //-prefixed path.
      upstream.pathname = url.pathname;
      upstream.search = url.search;
      upstream.hash = url.hash;
      url = upstream;
      projected = true;
    }
    if (protectedAlias.test(url.hostname) || internalPath(url)) continue;
    if (projected) {
      // URLSearchParams.delete would reserialize opaque/signed query values.
      url.search = url.search
        .slice(1)
        .split("&")
        .filter((part) => {
          const key = new URLSearchParams(part).keys().next().value;
          return !navigationKeys.has(key ?? "");
        })
        .join("&");
    }
    urls.add(url.href);
  }
  return Array.from(urls, (url) => ({ name: new URL(url).host, path: url }));
}
