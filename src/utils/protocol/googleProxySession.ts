import catalog from "./googleHostedRoutes.json";

export interface GoogleProxyRoute {
  upstreamOrigin: string;
  proxyOrigin: string;
  documents: boolean;
}

export function expectedGoogleOrigins(source: string): Map<string, boolean> {
  const profile = Object.entries(catalog.profiles).find(
    ([, origin]) => origin === source,
  )?.[0];
  if (!profile) return new Map();
  return new Map([
    [source, true],
    ...catalog.loginOrigins.map((origin): [string, boolean] => [origin, true]),
    ...catalog.resourceOrigins.map((origin): [string, boolean] => [
      origin,
      false,
    ]),
    ...(
      (catalog.profileOrigins as Record<string, string[]>)[profile] ?? []
    ).map((origin): [string, boolean] => [origin, profile === "youtube"]),
  ]);
}

/** Accept only the native start/restart response, never a page message. */
export function validateGoogleProxyRoutes(
  value: unknown,
  source: string,
  proxy: string,
  required: boolean,
): GoogleProxyRoute[] {
  const expected = expectedGoogleOrigins(new URL(source).origin);
  if (
    !required &&
    (value === undefined || (Array.isArray(value) && !value.length))
  )
    return [];
  if (!expected.size) {
    if (value === undefined || (Array.isArray(value) && value.length === 0))
      throw new Error("Native Google routes are unavailable for this target.");
    throw new Error("Unexpected native Google session routes.");
  }
  const base = new URL(proxy);
  if (!Array.isArray(value) || value.length !== expected.size)
    throw new Error("Invalid native Google session routes.");
  const seen = new Set<string>();
  const origins = new Set<string>();
  return value.map((row: unknown) => {
    if (!row || typeof row !== "object")
      throw new Error("Invalid native Google session route.");
    const route = row as GoogleProxyRoute;
    const local = new URL(route.proxyOrigin);
    if (
      expected.get(route.upstreamOrigin) !== route.documents ||
      !expected.has(route.upstreamOrigin) ||
      seen.has(route.proxyOrigin) ||
      origins.has(route.upstreamOrigin) ||
      local.origin !== route.proxyOrigin ||
      local.protocol !== "http:" ||
      local.port !== base.port ||
      !/^p[0-9a-f]{32}\.localhost$/.test(local.hostname) ||
      (route.upstreamOrigin === new URL(source).origin &&
        route.proxyOrigin !== base.origin)
    )
      throw new Error("Unsafe native Google session route.");
    seen.add(route.proxyOrigin);
    origins.add(route.upstreamOrigin);
    return {
      upstreamOrigin: route.upstreamOrigin,
      proxyOrigin: route.proxyOrigin,
      documents: route.documents,
    };
  });
}

/** URL projection only. This never grants credential/TOTP redemption. */
export function googleUpstreamForProxy(
  routes: readonly GoogleProxyRoute[],
  url: URL,
): string | undefined {
  const route = routes.find(
    (route) => route.documents && route.proxyOrigin === url.origin,
  );
  if (!route || url.username || url.password) return undefined;
  return route.upstreamOrigin + url.pathname + url.search + url.hash;
}

/** Map one reviewed upstream document URL onto its native-issued alias. */
export function googleProxyForUpstream(
  routes: readonly GoogleProxyRoute[],
  url: URL,
): string | undefined {
  const route = routes.find(
    (route) => route.documents && route.upstreamOrigin === url.origin,
  );
  if (!route || url.username || url.password) return undefined;
  return route.proxyOrigin + url.pathname + url.search + url.hash;
}

/**
 * Start a reviewed Google service at Accounts, then return to the exact service
 * URL through the already-approved redirect routes. The service remains the
 * native session owner; Accounts is only the first in-session document.
 */
export function googleAccountsEntryFor(
  routes: readonly GoogleProxyRoute[],
  target: URL,
): string | undefined {
  if (
    target.protocol !== "https:" ||
    target.username ||
    target.password ||
    target.port ||
    !routes.some(
      (route) => route.documents && route.upstreamOrigin === target.origin,
    )
  )
    return undefined;
  const account = routes.find(
    (route) =>
      route.documents && route.upstreamOrigin === "https://accounts.google.com",
  );
  if (!account) return undefined;
  const entry = new URL("/ServiceLogin", account.proxyOrigin);
  entry.searchParams.set("continue", target.href);
  entry.searchParams.set("followup", target.href);
  return entry.href;
}
