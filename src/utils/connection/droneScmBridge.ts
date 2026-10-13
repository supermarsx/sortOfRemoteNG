/**
 * Drone CI bridged sign-in (r1-drone).
 *
 * Drone has no local accounts. Its `/login` sends the browser to the Git
 * provider (SCM) it was configured with, and the SCM sends it back to
 * `<drone>/login` with a one-time code. "Bridged" automatic login therefore
 * follows: Drone -> SCM sign-in (+ authenticator code) -> SCM consent -> Drone.
 *
 * This module is the single, data-only description of that bridge for one
 * connection. It decides nothing at run time from page content:
 *
 * 1. The SCM origin is SAVED on the Drone connection (`droneScmOrigin`),
 *    never taken from a redirect at run time. `deriveDroneScmFromRedirect`
 *    may PROPOSE it from Drone's `/login` redirect for the user to confirm,
 *    and only when that redirect's callback is exactly `<drone>/login`.
 * 2. Username and password are typed only on `credentialOrigins`: the saved
 *    SCM origin for an OAuth SCM with a reviewed form, the Drone origin for
 *    Gogs (Drone shows its own form there), and nowhere else. The Drone
 *    origin never receives credentials for an OAuth SCM.
 * 3. A one-time code is typed only on the HTTPS SCM origin, on the reviewed
 *    challenge path.
 * 4. The consent ("Authorize Application") click is described only for an
 *    SCM whose consent page is reviewed (Gitea), only with a SAVED client id,
 *    and it must be checked against the saved SCM origin, the reviewed path,
 *    that client id and this Drone's own callback.
 *
 * Nothing here holds or copies a secret. Linking a saved Gitea connection
 * shares its database-vault reference; local passwords never travel.
 */
import type {
  Connection,
  HttpAutoLoginSelectors,
} from "../../types/connection/connection";
import type { ConnectionCredentialSource } from "../../types/security/databaseCredentialVault";
import { normalizeHttpRedirectOrigin } from "../protocol/httpTrustedRedirectDestinations";

export const DRONE_SCM_PROVIDERS = [
  "gitea",
  "gogs",
  "github",
  "gitlab",
  "bitbucket",
] as const;
export type DroneScmProvider = (typeof DRONE_SCM_PROVIDERS)[number];

/** Saved, non-secret bridge settings of one Drone connection. */
export interface DroneScmSettings {
  provider: DroneScmProvider;
  /** Exact SCM origin; required for self-hosted SCMs. */
  origin?: string;
  /** The OAuth application's client id Drone uses; public, not a secret. */
  clientId?: string;
}

export interface DroneScmTotpChallenge {
  id: string;
  label: string;
  codeSelector: string;
  submitSelector: string;
  paths: readonly string[];
  submission: "post";
}

export interface DroneScmConsentSpec {
  /** Exact pathname of the page that shows the consent form. */
  paths: readonly string[];
  /** Pathname (below the SCM origin) the consent form must post to. */
  formAction: string;
  formSelector: string;
  /** The approving control only; the deny control never matches it. */
  buttonSelector: string;
  evidence: string;
}

export interface DroneScmSpec {
  label: string;
  /** `oauth`: Drone redirects to the SCM. `drone-form`: Drone shows a form. */
  flow: "oauth" | "drone-form";
  /** Default origin of a hosted SCM. */
  defaultOrigin?: string;
  /** The SCM origin cannot be changed (hosted-only SCM). */
  fixedOrigin?: boolean;
  /** Where Drone's `/login` sends the browser (OAuth SCMs). */
  authorizePath?: string;
  signIn: null | {
    selectors: Readonly<HttpAutoLoginSelectors>;
    /** Exact paths where the form is expected; omitted means any path. */
    paths?: readonly string[];
    /** The reviewed form applies only on this origin (hosted product). */
    onlyOrigin?: string;
    /** The reviewed form never applies on this origin. */
    notOrigin?: string;
    evidence: string;
  };
  totp: DroneScmTotpChallenge | null;
  consent: DroneScmConsentSpec | null;
}

/**
 * The reviewed SCM pages. The Gitea, GitHub and GitLab sign-in selectors are
 * the catalog's own profiles (`gitea`, `github`, `gitlab-self-hosted`), kept
 * equal by `tests/utils/droneScmBridge.test.ts`; they are repeated here so this
 * module does not import the catalog that will import it.
 */
export const DRONE_SCM_SPECS: Readonly<Record<DroneScmProvider, DroneScmSpec>> =
  {
    gitea: {
      label: "Gitea",
      flow: "oauth",
      authorizePath: "/login/oauth/authorize",
      signIn: {
        selectors: {
          usernameSelector:
            'form[action$="/user/login"] input#user_name[name="user_name"]',
          passwordSelector:
            'form[action$="/user/login"] input#password[name="password"][type="password"]',
          submitSelector: 'form[action$="/user/login"] button.ui.primary',
        },
        evidence:
          "go-gitea/gitea v1.27.3 templates/user/auth/signin_inner.tmpl",
      },
      totp: {
        id: "drone-ci-gitea-totp",
        label: "Gitea authenticator (Drone sign-in)",
        codeSelector:
          'form[action$="/user/two_factor"] input#passcode[name="passcode"][autocomplete="one-time-code"]',
        submitSelector: 'form[action$="/user/two_factor"] button.ui.primary',
        paths: ["/user/two_factor"],
        submission: "post",
      },
      consent: {
        paths: ["/login/oauth/authorize"],
        formAction: "/login/oauth/grant",
        formSelector: 'form[method="post" i][action$="/login/oauth/grant"]',
        buttonSelector:
          'button#authorize-app[type="submit"][name="granted"][value="true"]',
        evidence: "go-gitea/gitea release/v1.24 templates/user/auth/grant.tmpl",
      },
    },
    gogs: {
      label: "Gogs",
      flow: "drone-form",
      signIn: {
        selectors: {
          usernameSelector:
            'form[method="post" i][action="/login"] input[type="text"][name="username"]',
          passwordSelector:
            'form[method="post" i][action="/login"] input[type="password"][name="password"]',
          submitSelector:
            'form[method="post" i][action="/login"] input[type="submit"]',
        },
        paths: ["/login/form"],
        evidence: "harness/harness branch drone handler/web/login.go loginForm",
      },
      totp: null,
      consent: null,
    },
    github: {
      label: "GitHub",
      flow: "oauth",
      defaultOrigin: "https://github.com",
      authorizePath: "/login/oauth/authorize",
      signIn: {
        selectors: {
          usernameSelector:
            'form[action="/session"] input#login_field[name="login"]',
          passwordSelector:
            'form[action="/session"] input#password[name="password"][type="password"]',
          submitSelector:
            'form[action="/session"] input[name="commit"][type="submit"]',
        },
        onlyOrigin: "https://github.com",
        evidence: "catalog profile github (github.com/login, September 2026)",
      },
      totp: null,
      consent: null,
    },
    gitlab: {
      label: "GitLab",
      flow: "oauth",
      authorizePath: "/oauth/authorize",
      signIn: {
        selectors: {
          usernameSelector:
            'form#sign-in-form input[name="user[login]"][autocomplete="username"]',
          passwordSelector:
            'form#sign-in-form input[name="user[password]"][type="password"]',
          submitSelector:
            'form#sign-in-form button[data-testid="sign-in-button"][type="submit"]',
        },
        notOrigin: "https://gitlab.com",
        evidence: "catalog profile gitlab-self-hosted",
      },
      totp: null,
      consent: null,
    },
    bitbucket: {
      label: "Bitbucket Cloud",
      flow: "oauth",
      defaultOrigin: "https://bitbucket.org",
      fixedOrigin: true,
      authorizePath: "/site/oauth2/authorize",
      signIn: null,
      totp: null,
      consent: null,
    },
  };

export type DroneScmIssue =
  | "invalid-settings"
  | "unknown-field"
  | "invalid-provider"
  | "invalid-scm-origin"
  | "invalid-client-id"
  | "invalid-drone-origin"
  | "scm-origin-required"
  | "scm-origin-fixed"
  | "scm-origin-is-drone"
  | "insecure-scm-origin"
  | "invalid-redirect-target"
  | "not-an-authorize-redirect"
  | "callback-not-drone"
  | "not-an-scm-connection";

/** What stays with the user; fixed codes, never page text. */
export type DroneScmInteractive =
  "consent-needs-client-id" | "consent-unreviewed" | "sign-in-unreviewed";

export type DroneScmResult<T> =
  { ok: true; value: T } | { ok: false; issue: DroneScmIssue };

const fail = (issue: DroneScmIssue): { ok: false; issue: DroneScmIssue } => ({
  ok: false,
  issue,
});

const CLIENT_ID = /^[A-Za-z0-9._~-]{1,128}$/;

function isProvider(value: unknown): value is DroneScmProvider {
  return (
    typeof value === "string" &&
    (DRONE_SCM_PROVIDERS as readonly string[]).includes(value)
  );
}

function origin(value: unknown): string | null {
  try {
    return normalizeHttpRedirectOrigin(value);
  } catch {
    return null;
  }
}

/** Fail-closed reading of saved settings; a rejected value is never used in part. */
export function normalizeDroneScmSettings(
  value: unknown,
): DroneScmResult<DroneScmSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail("invalid-settings");
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some(
      (key) => !["provider", "origin", "clientId"].includes(key),
    )
  )
    return fail("unknown-field");
  if (!isProvider(raw.provider)) return fail("invalid-provider");
  const settings: DroneScmSettings = { provider: raw.provider };
  if (raw.origin !== undefined) {
    const normalized = origin(raw.origin);
    if (!normalized) return fail("invalid-scm-origin");
    settings.origin = normalized;
  }
  if (raw.clientId !== undefined) {
    if (typeof raw.clientId !== "string" || !CLIENT_ID.test(raw.clientId))
      return fail("invalid-client-id");
    settings.clientId = raw.clientId;
  }
  return { ok: true, value: settings };
}

export interface DroneScmBridge {
  provider: DroneScmProvider;
  droneOrigin: string;
  /** Null for Gogs: its sign-in happens on Drone. */
  scmOrigin: string | null;
  /** Opening this starts the bridge without a Drone page in between. */
  entryUrl: string;
  /** The only callback the SCM may send the browser back to. */
  redirectUri: string;
  /** Username and password: exactly these origins, nothing else. */
  credentialOrigins: string[];
  /** Origins the tab must be allowed to navigate to (not credential grants). */
  navigationOrigins: string[];
  signIn: null | {
    origin: string;
    paths?: readonly string[];
    selectors: Readonly<HttpAutoLoginSelectors>;
  };
  totp: null | { origin: string; challenge: DroneScmTotpChallenge };
  consent: null | {
    origin: string;
    paths: readonly string[];
    formAction: string;
    formSelector: string;
    buttonSelector: string;
    clientId: string;
    redirectUri: string;
  };
  interactive: DroneScmInteractive[];
}

function droneOriginOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return origin(url.origin);
  } catch {
    return null;
  }
}

/** The bridge for one Drone connection, or why it cannot run. */
export function resolveDroneScmBridge(
  rawSettings: unknown,
  droneUrl: string,
): DroneScmResult<DroneScmBridge> {
  const normalized = normalizeDroneScmSettings(rawSettings);
  if (!normalized.ok) return normalized;
  const settings = normalized.value;
  const droneOrigin = droneOriginOf(droneUrl);
  if (!droneOrigin) return fail("invalid-drone-origin");
  const spec = DRONE_SCM_SPECS[settings.provider];
  const redirectUri = `${droneOrigin}/login`;
  const interactive: DroneScmInteractive[] = [];

  if (spec.flow === "drone-form") {
    // Gogs: Drone posts the pair to Gogs' API itself. A saved Gogs origin is
    // informational only and never becomes a credential or navigation grant.
    if (settings.origin === droneOrigin) return fail("scm-origin-is-drone");
    return {
      ok: true,
      value: {
        provider: settings.provider,
        droneOrigin,
        scmOrigin: null,
        entryUrl: redirectUri,
        redirectUri,
        credentialOrigins: spec.signIn ? [droneOrigin] : [],
        navigationOrigins: [],
        signIn: spec.signIn
          ? {
              origin: droneOrigin,
              paths: spec.signIn.paths,
              selectors: spec.signIn.selectors,
            }
          : null,
        totp: null,
        consent: null,
        interactive,
      },
    };
  }

  if (
    spec.fixedOrigin &&
    settings.origin &&
    settings.origin !== spec.defaultOrigin
  )
    return fail("scm-origin-fixed");
  const scmOrigin = settings.origin ?? spec.defaultOrigin;
  if (!scmOrigin) return fail("scm-origin-required");
  if (scmOrigin === droneOrigin) return fail("scm-origin-is-drone");
  // The SCM leg carries the password and the one-time code, and the native
  // engine grants nothing beyond the saved source except exact HTTPS origins.
  if (!scmOrigin.startsWith("https:")) return fail("insecure-scm-origin");

  const signInApplies =
    !!spec.signIn &&
    (!spec.signIn.onlyOrigin || spec.signIn.onlyOrigin === scmOrigin) &&
    (!spec.signIn.notOrigin || spec.signIn.notOrigin !== scmOrigin);
  if (!signInApplies) interactive.push("sign-in-unreviewed");

  let totp: DroneScmBridge["totp"] = null;
  if (signInApplies && spec.totp)
    totp = { origin: scmOrigin, challenge: spec.totp };

  let consent: DroneScmBridge["consent"] = null;
  if (!spec.consent) interactive.push("consent-unreviewed");
  else if (!settings.clientId) interactive.push("consent-needs-client-id");
  else
    consent = {
      origin: scmOrigin,
      paths: spec.consent.paths,
      formAction: spec.consent.formAction,
      formSelector: spec.consent.formSelector,
      buttonSelector: spec.consent.buttonSelector,
      clientId: settings.clientId,
      redirectUri,
    };

  return {
    ok: true,
    value: {
      provider: settings.provider,
      droneOrigin,
      scmOrigin,
      entryUrl: redirectUri,
      redirectUri,
      credentialOrigins: signInApplies ? [scmOrigin] : [],
      navigationOrigins: [scmOrigin],
      signIn: signInApplies
        ? { origin: scmOrigin, selectors: spec.signIn!.selectors }
        : null,
      totp,
      consent,
      interactive,
    },
  };
}

export interface DroneScmProposal {
  /** Candidates; `/login/oauth/authorize` off github.com is Gitea or GitHub Enterprise. */
  providers: DroneScmProvider[];
  origin: string | null;
  clientId: string | null;
}

/**
 * Proposes bridge settings from the `Location` Drone's `/login` answered
 * with. A proposal for the user to confirm and save; it grants nothing.
 */
export function deriveDroneScmFromRedirect(
  droneUrl: string,
  location: string,
): DroneScmResult<DroneScmProposal> {
  const droneOrigin = droneOriginOf(droneUrl);
  if (!droneOrigin) return fail("invalid-drone-origin");
  if (
    typeof location !== "string" ||
    location.length > 4096 ||
    /[\s\\]/u.test(location)
  )
    return fail("invalid-redirect-target");
  let target: URL;
  try {
    target = new URL(location, `${droneOrigin}/login`);
  } catch {
    return fail("invalid-redirect-target");
  }
  if (
    (target.protocol !== "https:" && target.protocol !== "http:") ||
    target.username ||
    target.password
  )
    return fail("invalid-redirect-target");
  const targetOrigin = origin(target.origin);
  if (!targetOrigin) return fail("invalid-redirect-target");

  if (targetOrigin === droneOrigin) {
    if (target.pathname === "/login/form")
      return {
        ok: true,
        value: { providers: ["gogs"], origin: null, clientId: null },
      };
    return fail("not-an-authorize-redirect");
  }

  let providers: DroneScmProvider[];
  if (target.pathname === "/login/oauth/authorize")
    providers =
      targetOrigin === "https://github.com" ? ["github"] : ["gitea", "github"];
  else if (target.pathname === "/oauth/authorize") providers = ["gitlab"];
  else if (
    target.pathname === "/site/oauth2/authorize" &&
    targetOrigin === "https://bitbucket.org"
  )
    providers = ["bitbucket"];
  else return fail("not-an-authorize-redirect");

  if (target.searchParams.get("response_type") !== "code")
    return fail("not-an-authorize-redirect");
  if (
    target.searchParams.getAll("redirect_uri").length !== 1 ||
    target.searchParams.get("redirect_uri") !== `${droneOrigin}/login`
  )
    return fail("callback-not-drone");
  const clientId = target.searchParams.get("client_id") ?? "";
  if (
    target.searchParams.getAll("client_id").length !== 1 ||
    !CLIENT_ID.test(clientId)
  )
    return fail("invalid-client-id");
  if (!targetOrigin.startsWith("https:")) return fail("insecure-scm-origin");
  return { ok: true, value: { providers, origin: targetOrigin, clientId } };
}

/**
 * Run-time check of an SCM authorize address against the saved bridge: the
 * saved SCM origin, the reviewed path, the saved client id (when one is
 * saved) and this Drone's callback, each exactly.
 */
export function checkDroneScmAuthorizeUrl(
  bridge: DroneScmBridge,
  value: string,
): boolean {
  const spec = DRONE_SCM_SPECS[bridge.provider];
  if (!bridge.scmOrigin || !spec.authorizePath) return false;
  try {
    const url = new URL(value);
    const params = url.searchParams;
    const clientId = params.getAll("client_id");
    const redirect = params.getAll("redirect_uri");
    const expectedClient = bridge.consent?.clientId;
    return (
      !url.username &&
      !url.password &&
      origin(url.origin) === bridge.scmOrigin &&
      url.pathname === spec.authorizePath &&
      redirect.length === 1 &&
      redirect[0] === bridge.redirectUri &&
      clientId.length === 1 &&
      CLIENT_ID.test(clientId[0]) &&
      (!expectedClient || clientId[0] === expectedClient)
    );
  } catch {
    return false;
  }
}

export interface DroneScmLink {
  settings: DroneScmSettings;
  /** The SCM connection's vault reference, shared as is; null when it signs
   * in with fields of its own, which are never copied. */
  credentialSource: Extract<
    ConnectionCredentialSource,
    { kind: "vault" }
  > | null;
}

const LINKABLE: Readonly<Record<string, DroneScmProvider>> = {
  gitea: "gitea",
  github: "github",
  "gitlab-self-hosted": "gitlab",
};

/** Bridge settings from a saved SCM connection: its origin, never its secrets. */
export function linkDroneScmFromConnection(
  source: Pick<Connection, "protocol" | "hostname"> &
    Partial<Pick<Connection, "port" | "httpApplication" | "credentialSource">>,
): DroneScmResult<DroneScmLink> {
  const provider = LINKABLE[source.httpApplication?.id ?? ""];
  if (
    !provider ||
    source.httpApplication?.invalid ||
    (source.protocol !== "https" && source.protocol !== "http") ||
    typeof source.hostname !== "string"
  )
    return fail("not-an-scm-connection");
  let scmOrigin: string | null;
  try {
    const url = new URL(`${source.protocol}://${source.hostname}/`);
    if (source.port) url.port = String(source.port);
    if (url.pathname !== "/" || url.search || url.hash || url.username)
      return fail("invalid-scm-origin");
    scmOrigin = origin(url.origin);
  } catch {
    scmOrigin = null;
  }
  if (!scmOrigin) return fail("invalid-scm-origin");
  const shared = source.credentialSource;
  const credentialSource =
    shared && shared.kind === "vault"
      ? {
          kind: "vault" as const,
          credentialId: shared.credentialId,
          ...(shared.totpId ? { totpId: shared.totpId } : {}),
        }
      : null;
  return {
    ok: true,
    value: { settings: { provider, origin: scmOrigin }, credentialSource },
  };
}
