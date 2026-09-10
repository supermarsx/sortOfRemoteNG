import type {
  Connection,
  HttpAutoLoginSelectors,
} from "../../types/connection/connection";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../connection/httpApplicationProfiles";
import { resolveHttpBasicCredentials } from "./httpCredentials";

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
    "none" | "basic" | "digest" | "header" | "bitwarden-form" | "synology-form";
  loginFlow?: "bitwarden" | "synology";
  autoLogin: boolean;
  selectors?: HttpAutoLoginSelectors;
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
): HttpApplicationLogin {
  if (connection?.httpApplication === undefined) {
    if (connection?.authType === "header")
      return {
        credentials: null,
        upstreamAuthMode: "header",
        autoLogin: false,
      };
    if (connection?.authType === "digest")
      return {
        credentials: resolveHttpBasicCredentials({
          ...connection,
          authType: "basic",
        }),
        upstreamAuthMode: "digest",
        autoLogin: false,
      };
    return {
      credentials: resolveHttpBasicCredentials(connection),
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
  const credentials = resolveHttpBasicCredentials({
    ...connection,
    authType: "basic",
  });
  if (!credentials)
    throw new Error(
      "Application login requires this connection's saved website credentials. Review Application settings.",
    );
  if (settings.loginMode === "basic" || settings.loginMode === "digest")
    return {
      credentials,
      upstreamAuthMode: settings.loginMode,
      autoLogin: false,
    };
  if (!credentials.username || !credentials.password)
    throw new Error(
      "Automatic form login requires both the website username and password.",
    );
  if (profile.loginFlow === "bitwarden" || profile.loginFlow === "synology") {
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
      upstreamAuthMode:
        profile.loginFlow === "synology" ? "synology-form" : "bitwarden-form",
      loginFlow: profile.loginFlow,
      autoLogin: true,
    };
  }
  const selectors = {
    ...profile.selectors,
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
    settings.id === "proxmox" && !credentials.username.includes("@")
      ? `${credentials.username}@${settings.realm ?? "pam"}`
      : credentials.username;
  return {
    credentials: { ...credentials, username },
    upstreamAuthMode: "none",
    autoLogin: true,
    ...(Object.keys(selectors).length ? { selectors } : {}),
  };
}
