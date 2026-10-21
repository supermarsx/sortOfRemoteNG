import type { Connection } from "../../types/connection/connection";
import {
  getFirstPartyGoogleHostedApplicationUrl,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../connection/httpApplicationProfiles";
import {
  parseCanonicalWebAuthority,
  resolveCanonicalWebPort,
} from "../connection/sanitizeHostname";
import { validateHttpApplicationTarget } from "./httpApplicationLogin";
import { resolveExchangeOwaInitialUrl } from "../connection/exchangeOwaProfile";
import { applyStandardNotesSignInEntry } from "../connection/standardNotesProfiles";

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
    const port = resolveCanonicalWebPort(authority.port, connection.port, 443);
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
      (profile?.id === "amazon-shopping" ? "/" : profile?.hostedLoginUrl) ??
        settings?.loginPath ??
        profile?.loginPath ??
        "/",
      savedOrigin,
    );
    // Match the embedded initial URL for tenant/self-hosted installations.
    // Assign pathname (not a relative URL) so a leading // cannot change host.
    // Never copy query strings, fragments or a live page's navigation state.
    if (
      !profile?.hostedLoginUrl &&
      authority.initialPathname &&
      (authority.initialPathname !== "/" ||
        authority.initialSearch ||
        authority.initialHash)
    ) {
      external.pathname = authority.initialPathname;
    }
    applyStandardNotesSignInEntry(external, settings?.id, settings?.loginMode);
    const notesEntry = new URL(external);
    notesEntry.search = "";
    applyStandardNotesSignInEntry(
      notesEntry,
      settings?.id,
      settings?.loginMode,
    );
    if (
      external.origin !== savedOrigin ||
      external.username ||
      external.password ||
      external.search !== notesEntry.search ||
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
