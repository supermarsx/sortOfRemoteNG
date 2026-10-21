import type {
  Connection,
  ConnectionSession,
} from "../../types/connection/connection";
import {
  parseCanonicalWebAuthority,
  resolveCanonicalWebPort,
} from "../../utils/connection/sanitizeHostname";
import {
  getFirstPartyGoogleHostedApplicationUrl,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../utils/connection/httpApplicationProfiles";
import { resolveExchangeOwaInitialUrl } from "../../utils/connection/exchangeOwaProfile";
import { applyStandardNotesSignInEntry } from "../../utils/connection/standardNotesProfiles";

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
  const port = resolveCanonicalWebPort(
    authority.port,
    configuredPort,
    defaultPort,
  );
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
  // Drone's /login starts the Git provider leg at once (a bridged sign-in);
  // manual mode keeps the saved page.
  if (
    (profile?.id === "cloudflare" || profile?.id === "drone-ci") &&
    app?.loginMode === "form"
  )
    target.pathname = "/login";
  if (profile?.loginFlow === "bitwarden") target.hash = "/login";
  applyStandardNotesSignInEntry(target, app?.id, app?.loginMode);
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

/** Native builds a saved tab's source from the saved row alone and rejects a
 * request that differs, while the session row only copied the host and scheme
 * when its tab opened. What that row has to say for the next attempt, or null
 * once the saved connection is no longer a website. */
export function originBrowserSavedSource(
  connection: Connection,
): Pick<ConnectionSession, "protocol" | "hostname"> | null {
  if (
    connection.isGroup ||
    (connection.protocol !== "http" && connection.protocol !== "https")
  )
    return null;
  return { protocol: connection.protocol, hostname: connection.hostname };
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
