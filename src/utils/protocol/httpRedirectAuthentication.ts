import type { Connection } from "../../types/connection/connection";
import { resolveHttpApplicationLogin } from "../auth/httpApplicationLogin";
import {
  anonymousRedirectConnection,
  type HttpRedirectReview,
} from "./httpRedirectReview";
import type { EffectiveHttpProxyPolicy } from "./synologyRedirectDefaults";

export interface HttpRedirectAuthentication {
  version: 1;
  mode: "none" | "saved-login";
  allowInsecureHttp: boolean;
}
export const DEFAULT_REDIRECT_AUTHENTICATION: HttpRedirectAuthentication = {
  version: 1,
  mode: "none",
  allowInsecureHttp: false,
};
export function normalizeRedirectAuthentication(
  value: unknown,
): HttpRedirectAuthentication {
  if (value === undefined) return { ...DEFAULT_REDIRECT_AUTHENTICATION };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid redirect authentication settings.");
  const entry = value as Record<string, unknown>;
  if (
    Object.keys(entry).some(
      (key) => !["version", "mode", "allowInsecureHttp"].includes(key),
    ) ||
    entry.version !== 1 ||
    !["none", "saved-login"].includes(String(entry.mode)) ||
    typeof entry.allowInsecureHttp !== "boolean"
  )
    throw new Error("Invalid redirect authentication settings.");
  return {
    version: 1,
    mode: entry.mode as HttpRedirectAuthentication["mode"],
    allowInsecureHttp: entry.allowInsecureHttp,
  };
}
export function redirectAuthenticationAvailability(
  source?: Connection,
  review?: HttpRedirectReview | null,
) {
  try {
    const policy = normalizeRedirectAuthentication(
      source?.httpRedirectAuthentication,
    );
    const login = resolveHttpApplicationLogin(source);
    const configured = policy.mode === "saved-login";
    const insecure = review?.destinationUrl.startsWith("http:") === true;
    const available =
      configured &&
      !!login.credentials?.username &&
      !!login.credentials.password &&
      (!insecure || policy.allowInsecureHttp);
    return {
      configured,
      available,
      insecure,
      reason: available
        ? ""
        : !configured
          ? "Saved login forwarding is off in this connection's Advanced settings."
          : insecure && !policy.allowInsecureHttp
            ? "Forwarding login details to HTTP is disabled in this connection's Advanced settings."
            : "This login has no reusable username/password pair. Browser cookies, social login sessions, passkeys and authentication headers are not transferred.",
    };
  } catch {
    return {
      configured: false,
      available: false,
      insecure: false,
      reason:
        "Review invalid redirect authentication or application login settings before continuing.",
    };
  }
}

/** Only a reviewed, explicit current-tab choice can carry a saved login. Never
 * copies cookies, tokens, query fields, hooks, MFA seeds, or vault references. */
export function authenticatedRedirectConnection(
  source: Connection,
  review: HttpRedirectReview,
  insecureApproved: boolean,
  effectivePolicy?: EffectiveHttpProxyPolicy,
): Connection {
  const availability = redirectAuthenticationAvailability(source, review);
  if (!availability.available || (availability.insecure && !insecureApproved))
    throw new Error(
      "Login forwarding requires explicit destination approval and separate approval for plaintext HTTP.",
    );
  const target = anonymousRedirectConnection(source, review, effectivePolicy);
  const login = resolveHttpApplicationLogin(source);
  if (!login.credentials) throw new Error("No saved login is available.");
  return {
    ...target,
    basicAuthUsername: login.credentials.username,
    basicAuthPassword: login.credentials.password,
    authType: login.upstreamAuthMode === "digest" ? "digest" : "basic",
    httpAutoLogin: login.autoLogin,
    httpAutoLoginSelectors: login.selectors
      ? { ...login.selectors }
      : undefined,
    httpApplication: source.httpApplication
      ? { ...source.httpApplication }
      : undefined,
    httpRedirectAuthentication: normalizeRedirectAuthentication(
      source.httpRedirectAuthentication,
    ),
  };
}
