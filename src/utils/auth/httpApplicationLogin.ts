import type {
  Connection,
  HttpAutoLoginSelectors,
} from "../../types/connection/connection";
import {
  getHttpApplicationProfile,
  getJoomlaLoginSelectors,
  normalizeHttpApplicationSettings,
} from "../connection/httpApplicationProfiles";
import { resolveHttpBasicCredentials } from "./httpCredentials";
import { YEALINK_SERVLET_UPSTREAM_SUPPORTED } from "./upstreamAuthCapabilities";
import { normalizeConnectionCredentialSource } from "../security/databaseCredentialVault";

export { YEALINK_SERVLET_UPSTREAM_SUPPORTED };

/** Hosted presets cannot label an arbitrary origin as their provider's login. */
export function validateHttpApplicationTarget(
  connection: Partial<Connection> | null | undefined,
  targetUrl: string,
): void {
  const profileId = normalizeHttpApplicationSettings(
    connection?.httpApplication,
  )?.id;
  const profile = profileId ? getHttpApplicationProfile(profileId) : undefined;
  const hostedLoginUrl = profile?.hostedLoginUrl;
  if (!hostedLoginUrl && profileId !== "tacticalrmm" && !profile?.requiresHttps)
    return;
  let valid = false;
  try {
    const target = new URL(targetUrl);
    valid =
      (hostedLoginUrl
        ? target.origin === new URL(hostedLoginUrl).origin
        : target.protocol === "https:") &&
      !target.username &&
      !target.password;
  } catch {
    /* Refuse malformed addresses before native preflight. */
  }
  if (!valid)
    throw new Error(
      profileId === "cloudflare"
        ? "Cloudflare Dashboard requires HTTPS at dash.cloudflare.com on port 443. Use the dashboard address in Application settings, or choose Generic website for another host."
        : hostedLoginUrl
          ? `${getHttpApplicationProfile(profileId!)!.label} requires HTTPS at ${new URL(hostedLoginUrl).hostname} on port 443. Use the hosted login address in Application settings, or choose a custom profile for another host.`
          : `${profile?.label ?? "This application"} requires an HTTPS website address. Review the connection protocol and address; API keys are not website passwords.`,
    );
}

export interface HttpApplicationLogin {
  credentials: { username: string; password: string } | null;
  upstreamAuthMode?:
    | "none"
    | "basic"
    | "digest"
    | "header"
    | "bitwarden-form"
    | "synology-form"
    | "yealink-servlet";
  loginFlow?: "bitwarden" | "synology" | "yealink";
  autoLogin: boolean;
  selectors?: HttpAutoLoginSelectors;
}

/** Each reviewed staged flow owns one closed upstream mode; no mode is shared. */
const STAGED_LOGIN_UPSTREAM_MODES: Record<
  NonNullable<HttpApplicationLogin["loginFlow"]>,
  NonNullable<HttpApplicationLogin["upstreamAuthMode"]>
> = {
  bitwarden: "bitwarden-form",
  synology: "synology-form",
  yealink: "yealink-servlet",
};

/** Never emit a mode the shipped backend would reject; see the gate's module. */
function stagedUpstreamAuthMode(
  loginFlow: NonNullable<HttpApplicationLogin["loginFlow"]>,
): NonNullable<HttpApplicationLogin["upstreamAuthMode"]> {
  if (loginFlow === "yealink" && !YEALINK_SERVLET_UPSTREAM_SUPPORTED)
    return "none";
  return STAGED_LOGIN_UPSTREAM_MODES[loginFlow];
}

/** Compare only login-affecting values in memory; never serialize credentials. */
export function sameHttpApplicationLogin(
  left: HttpApplicationLogin | null,
  right: HttpApplicationLogin | null,
): boolean {
  return (
    left === right ||
    (!!left &&
      !!right &&
      left.upstreamAuthMode === right.upstreamAuthMode &&
      left.autoLogin === right.autoLogin &&
      left.loginFlow === right.loginFlow &&
      left.credentials?.username === right.credentials?.username &&
      left.credentials?.password === right.credentials?.password &&
      left.selectors?.usernameSelector === right.selectors?.usernameSelector &&
      left.selectors?.passwordSelector === right.selectors?.passwordSelector &&
      left.selectors?.submitSelector === right.selectors?.submitSelector)
  );
}

export function normalizeHttpApplicationSelectors(
  value: unknown,
): HttpAutoLoginSelectors | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Invalid application login selectors. Review Application settings.",
    );
  const result: HttpAutoLoginSelectors = {};
  for (const key of [
    "usernameSelector",
    "passwordSelector",
    "submitSelector",
  ] as const) {
    const candidate = (value as Record<string, unknown>)[key];
    if (candidate === undefined || candidate === "") continue;
    if (
      typeof candidate !== "string" ||
      candidate.length > 512 ||
      Array.from(candidate).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error(
        "Invalid application login selector. Review Application settings.",
      );
    const selector = candidate.trim();
    if (!selector) continue;
    if (typeof document !== "undefined") {
      try {
        document.createDocumentFragment().querySelector(selector);
      } catch {
        throw new Error(
          "Invalid application login selector. Review Application settings.",
        );
      }
    }
    result[key] = selector;
  }
  return Object.keys(result).length ? result : undefined;
}

/** Prepare one protected proxy session; never mutate or re-save the connection. */
export function resolveHttpApplicationLogin(
  connection: Partial<Connection> | null | undefined,
  vaultCredentials?: { username: string; password: string },
): HttpApplicationLogin {
  const usesVault =
    normalizeConnectionCredentialSource(connection?.credentialSource)?.kind ===
    "vault";
  const deferred = usesVault && vaultCredentials === undefined;
  const credentialsFor = (candidate: Partial<Connection> | null | undefined) =>
    usesVault
      ? (vaultCredentials ?? null)
      : resolveHttpBasicCredentials(candidate);
  if (connection?.httpApplication === undefined) {
    if (connection?.authType === "header")
      return {
        credentials: null,
        upstreamAuthMode: "header",
        autoLogin: false,
      };
    if (connection?.authType === "digest")
      return {
        credentials: credentialsFor({
          ...connection,
          authType: "basic",
        }),
        upstreamAuthMode: "digest",
        autoLogin: false,
      };
    return {
      credentials: credentialsFor(connection),
      autoLogin: connection?.httpAutoLogin ?? false,
      selectors: connection?.httpAutoLoginSelectors,
    };
  }
  const settings = normalizeHttpApplicationSettings(
    connection.httpApplication,
  )!;
  if (settings.invalid)
    throw new Error(
      "This website application profile is invalid or unavailable. Review Application settings before connecting.",
    );
  const profile = getHttpApplicationProfile(settings.id)!;
  if (settings.loginMode === "manual")
    return { credentials: null, upstreamAuthMode: "none", autoLogin: false };
  const credentials = credentialsFor({
    ...connection,
    authType: "basic",
  });
  if (!credentials && !deferred)
    throw new Error(
      "Application login requires this connection's saved website credentials. Review Application settings.",
    );
  if (settings.loginMode === "basic" || settings.loginMode === "digest")
    return {
      credentials,
      upstreamAuthMode: settings.loginMode,
      autoLogin: false,
    };
  if (!deferred && (!credentials?.username || !credentials.password))
    throw new Error(
      "Automatic form login requires both the website username and password.",
    );
  if (profile.loginFlow) {
    if (
      Object.keys(
        normalizeHttpApplicationSelectors(connection.httpAutoLoginSelectors) ??
          {},
      ).length
    )
      throw new Error(
        "The reviewed staged login flow does not accept selector overrides. Clear Advanced selectors or use manual login.",
      );
    return {
      credentials,
      upstreamAuthMode: stagedUpstreamAuthMode(profile.loginFlow),
      loginFlow: profile.loginFlow,
      autoLogin: true,
      // A staged flow still carries its own reviewed selectors when it has
      // them: the Yealink confirm control is an anchor, so the page filler
      // reaches it through this override and never a submit-button search.
      ...(profile.selectors ? { selectors: { ...profile.selectors } } : {}),
    };
  }
  const selectors = {
    ...(settings.id === "joomla"
      ? getJoomlaLoginSelectors(settings.joomlaVersion)
      : profile.selectors),
    ...normalizeHttpApplicationSelectors(connection.httpAutoLoginSelectors),
  };
  if (
    profile.capability === "custom-form" &&
    (!selectors.usernameSelector?.trim() ||
      !selectors.passwordSelector?.trim() ||
      !selectors.submitSelector?.trim())
  ) {
    throw new Error(
      "Custom application form login requires explicit username, password, and submit selectors. Review Application settings.",
    );
  }
  const username =
    settings.id === "proxmox" &&
    credentials &&
    !credentials.username.includes("@")
      ? `${credentials.username}@${settings.realm ?? "pam"}`
      : (credentials?.username ?? "");
  return {
    credentials: credentials ? { ...credentials, username } : null,
    upstreamAuthMode: "none",
    autoLogin: true,
    ...(Object.keys(selectors).length ? { selectors } : {}),
  };
}
