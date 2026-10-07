import type {
  Connection,
  HttpAutoLoginSelectors,
} from "../../types/connection/connection";
import {
  getHttpApplicationProfile,
  getJoomlaLoginSelectors,
  getFirstPartyGoogleHostedApplicationUrl,
  normalizeHttpApplicationSettings,
} from "../connection/httpApplicationProfiles";
import { resolveHttpBasicCredentials } from "./httpCredentials";
import { YEALINK_SERVLET_UPSTREAM_SUPPORTED } from "./upstreamAuthCapabilities";
import { normalizeConnectionCredentialSource } from "../security/databaseCredentialVault";
import {
  detectAmazonShoppingMarket,
  getAmazonShoppingMarket,
} from "../connection/amazonProfiles";

export { YEALINK_SERVLET_UPSTREAM_SUPPORTED };

/**
 * Return only the backend's reviewed application capability marker.
 *
 * This is runtime plumbing for one proxy session, not connection metadata:
 * keep it derived from the normalized profile so malformed imports, generic
 * websites, and other application profiles cannot opt into the route.
 */
export function getReviewedApplicationProfile(
  connection: Partial<Connection> | null | undefined,
):
  | "tacticalrmm"
  | "google-hosted"
  | "cpanel"
  | "cloudflare"
  | "porkbun"
  | "ptisp"
  | "exchange-ecp"
  | "exchange-owa"
  | "adobe-admin-console"
  | "instagram"
  | "canva"
  | "chatgpt"
  | "claude"
  | "freepbx"
  | undefined {
  const settings = normalizeHttpApplicationSettings(
    connection?.httpApplication,
  );
  if (!settings || settings.invalid) return undefined;
  if (settings.id === "tacticalrmm") return "tacticalrmm";
  if (settings.id === "cpanel") return "cpanel";
  if (settings.id === "cloudflare") return "cloudflare";
  if (settings.id === "porkbun") return "porkbun";
  if (settings.id === "ptisp") return "ptisp";
  if (settings.id === "exchange-ecp") return "exchange-ecp";
  if (settings.id === "exchange-owa") return "exchange-owa";
  if (settings.id === "adobe-admin-console") return "adobe-admin-console";
  if (settings.id === "instagram") return "instagram";
  // Routing capability only: Canva does not grant a reviewed credential flow.
  if (settings.id === "canva") return "canva";
  if (settings.id === "chatgpt") return "chatgpt";
  if (settings.id === "claude") return "claude";
  if (settings.id === "freepbx") return "freepbx";
  return getFirstPartyGoogleHostedApplicationUrl(settings.id)
    ? "google-hosted"
    : undefined;
}

/** Exact non-secret API origin; only valid reviewed Tactical profiles may supply it. */
export function getReviewedApplicationApiOrigin(
  connection: Partial<Connection> | null | undefined,
): string | undefined {
  const settings = normalizeHttpApplicationSettings(
    connection?.httpApplication,
  );
  return settings?.id === "tacticalrmm" && !settings.invalid
    ? settings.apiOrigin
    : undefined;
}

/** Non-secret MeshCentral origin, emitted only for a valid reviewed Tactical profile. */
export function getReviewedApplicationMeshOrigin(
  connection: Partial<Connection> | null | undefined,
): string | undefined {
  const settings = normalizeHttpApplicationSettings(
    connection?.httpApplication,
  );
  return settings?.id === "tacticalrmm" && !settings.invalid
    ? settings.meshOrigin
    : undefined;
}

export const TACTICAL_MESH_ORIGIN_CONFLICT_MESSAGE =
  "MeshCentral origin must differ from the Tactical RMM dashboard origin. Review MeshCentral origin in the connection's Application settings.";

export function validateTacticalRmmMeshTarget(
  connection: Partial<Connection> | null | undefined,
  targetUrl: string,
): void {
  const meshOrigin = getReviewedApplicationMeshOrigin(connection);
  if (meshOrigin && meshOrigin === new URL(targetUrl).origin)
    throw new Error(TACTICAL_MESH_ORIGIN_CONFLICT_MESSAGE);
}

/** Hosted presets cannot label an arbitrary origin as their provider's login. */
export function validateHttpApplicationTarget(
  connection: Partial<Connection> | null | undefined,
  targetUrl: string,
): void {
  const settings = normalizeHttpApplicationSettings(
    connection?.httpApplication,
  );
  const profileId = settings?.id;
  const profile = profileId ? getHttpApplicationProfile(profileId) : undefined;
  if (profileId === "amazon-shopping") {
    const expectedMarket =
      settings?.amazonMarketplace && settings.amazonMarketplace !== "auto"
        ? getAmazonShoppingMarket(settings.amazonMarketplace)
        : detectAmazonShoppingMarket(connection?.hostname ?? "");
    let valid = false;
    try {
      const target = new URL(targetUrl);
      valid =
        !settings?.invalid &&
        !!expectedMarket &&
        target.protocol === "https:" &&
        detectAmazonShoppingMarket(targetUrl)?.code === expectedMarket.code;
    } catch {
      /* Refuse malformed targets. */
    }
    if (!valid)
      throw new Error(
        "Amazon Shopping requires a recognized HTTPS storefront on port 443 matching the selected marketplace. Review the saved URL or choose a marketplace in Application settings.",
      );
    return;
  }
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
  validateTacticalRmmMeshTarget(connection, targetUrl);
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
    | "google-form"
    | "cloudflare-form"
    | "adobe-form"
    | "chatgpt-form"
    | "claude-form"
    | "yealink-servlet";
  loginFlow?:
    | "bitwarden"
    | "synology"
    | "google"
    | "yealink"
    | "cloudflare"
    | "adobe"
    | "chatgpt"
    | "claude";
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
  google: "google-form",
  cloudflare: "cloudflare-form",
  adobe: "adobe-form",
  chatgpt: "chatgpt-form",
  claude: "claude-form",
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

/** Read email only; never read/copy password fields, even from a vault result. */
export function resolveHttpApplicationEmail(
  connection: Partial<Connection> | null | undefined,
  vaultCredentials?: { username: string },
): string {
  if (
    normalizeConnectionCredentialSource(connection?.credentialSource)?.kind ===
    "vault"
  )
    return typeof vaultCredentials?.username === "string"
      ? vaultCredentials.username
      : "";
  const dedicated = connection?.basicAuthUsername;
  if (dedicated != null && typeof dedicated !== "string") return "";
  if (dedicated) return dedicated;
  return typeof connection?.username === "string" ? connection.username : "";
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
  if (
    settings.id === "linkedin" &&
    (Object.keys(
      normalizeHttpApplicationSelectors(connection.httpAutoLoginSelectors) ??
        {},
    ).length ||
      connection.httpAutoMfa?.enabled ||
      connection.httpFormAutomation?.formSelector ||
      connection.httpFormAutomation?.fields?.length)
  )
    throw new Error(
      "LinkedIn uses its reviewed controls and interactive verification. Clear Advanced selectors, extra form fields and automatic MFA or use manual login.",
    );
  if (
    settings.id === "exchange-owa" &&
    (Object.keys(
      normalizeHttpApplicationSelectors(connection.httpAutoLoginSelectors) ??
        {},
    ).length ||
      connection.httpAutoMfa?.enabled)
  )
    throw new Error(
      "Exchange OWA uses its reviewed form selectors and interactive MFA. Clear Advanced selectors and automatic MFA or use manual login.",
    );
  if (
    (profile.id === "chatgpt" || profile.id === "claude") &&
    (connection.httpFormAutomation !== undefined ||
      connection.httpAutoMfa?.enabled)
  )
    throw new Error(
      "This bounded login flow does not support advanced form automation or automatic MFA. Clear those options or use manual login.",
    );
  const credentials = profile.emailOnly
    ? deferred
      ? null
      : {
          username: resolveHttpApplicationEmail(connection, vaultCredentials),
          password: "",
        }
    : credentialsFor({
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
  if (
    !deferred &&
    (!credentials?.username || (!profile.emailOnly && !credentials.password))
  )
    throw new Error(
      profile.emailOnly
        ? "Automatic email assistance requires the website email."
        : "Automatic form login requires both the website username and password.",
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
