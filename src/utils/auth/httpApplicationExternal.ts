import type { Connection } from "../../types/connection/connection";
import {
  getFirstPartyGoogleHostedApplicationUrl,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../connection/httpApplicationProfiles";
import { parseCanonicalWebAuthority } from "../connection/sanitizeHostname";
import { validateHttpApplicationTarget } from "./httpApplicationLogin";
import { resolveExchangeOwaInitialUrl } from "../connection/exchangeOwaProfile";

export interface HttpApplicationExternalTarget {
  label: string;
  url: string;
}

/** No live page URLs, credentials or proxy URLs; only reviewed saved entries. */
export function getHttpApplicationExternalTarget(
  connection: Partial<Connection> | null | undefined,
  sessionTarget: string,
): HttpApplicationExternalTarget | null {
  if (!connection || connection.protocol !== "https") return null;
  try {
    const settings = normalizeHttpApplicationSettings(
      connection.httpApplication,
    );
    if (settings?.invalid) return null;
    const profile = settings
      ? getHttpApplicationProfile(settings.id)
      : undefined;
    if (profile?.capability === "none") return null;
    const googleHostedUrl = getFirstPartyGoogleHostedApplicationUrl(
      settings?.id,
    );
    if (googleHostedUrl) {
      const external = new URL(googleHostedUrl);
      validateHttpApplicationTarget(connection, external.toString());
      return {
        label: profile?.label ?? "Google",
        url: external.toString(),
      };
    }
    const authority = parseCanonicalWebAuthority(connection.hostname ?? "");
    if (authority.sourceScheme && authority.sourceScheme !== "https")
      return null;
    if (
      authority.port &&
      connection.port !== undefined &&
      authority.port !== connection.port
    )
      return null;
    const port = connection.port ?? authority.port ?? 443;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    const savedOrigin = new URL(`https://${authority.hostname}:${port}`).origin;
    const target = new URL(sessionTarget);
    if (target.origin !== savedOrigin || target.username || target.password)
      return null;
    validateHttpApplicationTarget(connection, target.toString());
    if (settings?.id === "exchange-owa") {
      const savedEntry = new URL(savedOrigin);
      savedEntry.pathname = authority.initialPathname ?? "/";
      savedEntry.search = authority.initialSearch ?? "";
      savedEntry.hash = authority.initialHash ?? "";
      return {
        label: profile!.label,
        url: resolveExchangeOwaInitialUrl(
          savedEntry.toString(),
          settings.exchangeOwaMailbox,
        ),
      };
    }
    const external = new URL(
      profile?.hostedLoginUrl ??
        settings?.loginPath ??
        profile?.loginPath ??
        "/",
      savedOrigin,
    );
    if (
      external.origin !== savedOrigin ||
      external.username ||
      external.password ||
      external.search ||
      external.hash
    )
      return null;
    return {
      label:
        profile?.id === "cloudflare"
          ? "Cloudflare"
          : (profile?.label ?? "Website"),
      url: external.toString(),
    };
  } catch {
    return null;
  }
}
