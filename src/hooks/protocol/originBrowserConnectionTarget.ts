import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import { parseCanonicalWebAuthority } from "../../utils/connection/sanitizeHostname";
import {
  getFirstPartyGoogleHostedApplicationUrl,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../utils/connection/httpApplicationProfiles";
import { resolveExchangeOwaInitialUrl } from "../../utils/connection/exchangeOwaProfile";

/** A requested source only: native must independently validate the saved target. */
export function originBrowserConnectionTarget(
  connection: Connection,
  session: ConnectionSession,
): string {
  const app = normalizeHttpApplicationSettings(connection.httpApplication);
  if (app?.invalid) throw new Error("Invalid application settings");
  const profile = app ? getHttpApplicationProfile(app.id) : undefined;
  const hosted = getFirstPartyGoogleHostedApplicationUrl(app?.id);
  const google = hosted ? new URL(hosted) : null;
  const canonical =
    google &&
    (!session.hostname.trim() ||
      session.hostname.trim().toLowerCase() === google.hostname);
  const protocol = canonical
    ? google.protocol.slice(0, -1)
    : session.protocol === "https"
      ? "https"
      : "http";
  const authority = parseCanonicalWebAuthority(
    canonical ? google.hostname : session.hostname,
  );
  if (
    !canonical &&
    authority.sourceScheme &&
    authority.sourceScheme !== protocol
  )
    throw new Error("Conflicting scheme");
  const defaultPort = protocol === "https" ? 443 : 80;
  const configuredPort = canonical
    ? Number(google.port || defaultPort)
    : connection.port || undefined;
  if (authority.port && configuredPort && authority.port !== configuredPort)
    throw new Error("Conflicting port");
  const port = configuredPort ?? authority.port ?? defaultPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid port");
  let target = canonical
    ? new URL(google.href)
    : new URL(`${protocol}://${authority.hostname}/`);
  target.port = port === defaultPort ? "" : String(port);
  if (!canonical && profile?.hostedLoginUrl)
    target.pathname = new URL(profile.hostedLoginUrl).pathname;
  else if (app?.loginPath) target.pathname = app.loginPath;
  else if (profile?.loginPath) target.pathname = profile.loginPath;
  if (
    !canonical &&
    !profile?.hostedLoginUrl &&
    authority.initialPathname !== undefined &&
    (authority.initialPathname !== "/" ||
      authority.initialSearch ||
      authority.initialHash)
  ) {
    target.pathname = authority.initialPathname;
    target.search = authority.initialSearch ?? "";
    target.hash = authority.initialHash ?? "";
  }
  if (profile?.id === "cloudflare" && app?.loginMode === "form")
    target.pathname = "/login";
  if (profile?.loginFlow === "bitwarden") target.hash = "/login";
  if (app?.id === "exchange-owa")
    target = new URL(
      resolveExchangeOwaInitialUrl(target.href, app.exchangeOwaMailbox),
    );
  if (
    target.username ||
    target.password ||
    target.hostname !== authority.hostname
  )
    throw new Error("Invalid target");
  return target.href;
}

export function originBrowserDisplayUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}
