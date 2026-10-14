import type { HttpLoginSteps } from "../../types/connection/httpLoginSteps";
import type { HttpApplicationProfile } from "./httpApplicationProfiles";
import { HOSTED_DASHBOARD_INTERACTIVE_SIGN_IN } from "./hostedDashboardProfiles";
import {
  httpLoginStepMatchesPath,
  resolveHttpLoginSteps,
  validateHttpLoginSteps,
} from "./httpLoginSteps";
import { HTTP_LOGIN_STEPS_FILES } from "./httpLoginStepsRegistry";
import { INTERNATIONAL_PORTAL_MANUAL_SIGN_IN } from "./internationalPortalProfiles";
import { PORTUGAL_PORTAL_MANUAL_SIGN_IN } from "./portugalPortalProfiles";

/**
 * Joins the per-application login steps files (`src/data/loginSteps`, format
 * in `types/connection/httpLoginSteps`) to the application catalog. The type
 * import above is type-only: the catalog imports this module, not the reverse.
 */

/** A steps file the catalog will not use. `problem` holds a reason, rule
 * codes and field paths; never text copied from the file. */
export interface HttpApplicationLoginStepsProblem {
  id: string;
  problem: string;
}

/**
 * A steps file may only add a login where no reviewed automatic login exists:
 * a manual profile, or a named application that runs on generic form
 * detection. Reviewed forms, the staged adapters, the two user-configured
 * profiles and transport authentication are never replaced by steps.
 */
export function acceptsHttpLoginSteps(
  profile: HttpApplicationProfile,
): boolean {
  return (
    !profile.loginFlow &&
    !profile.selectors &&
    !profile.emailOnly &&
    (profile.capability === "manual" ||
      (profile.capability === "generic-form" && profile.id !== "generic-form"))
  );
}

/**
 * Checks every registered steps file with the format's validator and against
 * the profile it names. A file that fails is not used in part: its
 * application stays exactly as it is without steps.
 */
export function readHttpApplicationLoginSteps(
  profiles: readonly HttpApplicationProfile[],
): {
  steps: ReadonlyMap<string, HttpLoginSteps>;
  problems: readonly HttpApplicationLoginStepsProblem[];
} {
  const steps = new Map<string, HttpLoginSteps>();
  const problems: HttpApplicationLoginStepsProblem[] = [];
  const describe = (issues: readonly { code: string; path: string }[]) =>
    issues
      .map((issue) => `${issue.code} at ${issue.path || "(file)"}`)
      .join("; ");
  for (const [id, file] of HTTP_LOGIN_STEPS_FILES) {
    const refuse = (problem: string) => problems.push({ id, problem });
    const validated = validateHttpLoginSteps(file, { id });
    if (!validated.ok) {
      refuse(`invalid-format: ${describe(validated.issues)}`);
      continue;
    }
    const profile = profiles.find((candidate) => candidate.id === id);
    if (!profile) refuse("unknown-profile: no application profile has this id");
    else if (steps.has(id))
      refuse("duplicate: this application already has a steps file");
    else if (!acceptsHttpLoginSteps(profile))
      refuse(
        "not-eligible: steps apply only to a manual profile or a named application on generic form detection",
      );
    else {
      // A hosted profile's own origin is known now, so the per-origin rules
      // can be settled here instead of at the first connection.
      const hosted = profile.hostedLoginUrl
        ? resolveHttpLoginSteps(validated.value, {
            connectionOrigin: new URL(profile.hostedLoginUrl).origin,
          })
        : undefined;
      if (hosted && !hosted.ok)
        refuse(`invalid-for-hosted-origin: ${describe(hosted.issues)}`);
      else steps.set(id, validated.value);
    }
  }
  return { steps, problems };
}

/** The description of a named application that has only generic detection. */
export const GENERIC_FORM_DETECTION_NOTE =
  "Optional generic login-form detection; no application-specific browser sign-in has been verified.";

const AUTOMATIC_SIGN_IN =
  "Optional automatic sign-in types the saved username and password into the site's own sign-in pages, following the login steps recorded for this application, and stops at CAPTCHA, device approval, passkeys, SMS codes, security keys and any page it does not recognize. API keys are not website passwords.";

/**
 * What a description says while an application is manual-only, and what it
 * says instead once its login steps are active. Neither side claims that a
 * login was verified: the evidence class is shown separately by the editor.
 * The left side must occur verbatim in a profile description.
 */
const SIGN_IN_NOTES: readonly (readonly [
  manualOnly: string,
  withLoginSteps: string,
])[] = [
  [
    INTERNATIONAL_PORTAL_MANUAL_SIGN_IN,
    `${AUTOMATIC_SIGN_IN} Successful account sign-in has not been live-verified.`,
  ],
  [
    HOSTED_DASHBOARD_INTERACTIVE_SIGN_IN,
    `${AUTOMATIC_SIGN_IN} Use Open original sign-in for SSO or unsupported embedded-browser sign-in. The system browser has separate cookies and uses the operating system network route.`,
  ],
  [
    PORTUGAL_PORTAL_MANUAL_SIGN_IN,
    "Início de sessão automático opcional: o nome de utilizador e a palavra-passe guardados são escritos nas páginas de início de sessão do próprio portal, seguindo os passos de início de sessão registados para esta aplicação. CAPTCHA, códigos SMS, autenticação federada, Chave Móvel Digital, Cartão de Cidadão e páginas não reconhecidas ficam a cargo do utilizador.",
  ],
  // Amazon Shopping.
  [
    "Open the store's own Sign in / Account link and sign in interactively. Saved passwords, API keys and automatic 2FA are not supplied.",
    "Optional automatic sign-in types the saved username and password into the store's own sign-in pages, following the login steps recorded for this application; API keys are not website passwords.",
  ],
  [
    "This does not claim successful embedded sign-in or automatic login.",
    "Successful account sign-in has not been live-verified.",
  ],
  // The three AWS consoles.
  [
    "Interactive sign-in only: saved passwords, AWS access keys, session tokens and Amazon Shopping credentials are not supplied.",
    "Optional automatic sign-in types the saved console username and password into AWS's own sign-in pages, following the login steps recorded for this application; AWS access keys, session tokens and Amazon Shopping credentials are never used.",
  ],
  // Ghost and Strapi.
  [
    "Interactive Ghost staff sign-in, not member Portal or an Admin API key. Current Ghost uses a JavaScript form action that the guarded automatic-login client intentionally refuses.",
    "Ghost staff sign-in, not member Portal or an Admin API key. Optional automatic sign-in follows the login steps recorded for this application's script-driven staff form.",
  ],
  [
    "Interactive Strapi administrator sign-in, not a content API token or end-user account. The reviewed SPA declares a non-POST form method, so automatic credential submission is intentionally unavailable.",
    "Strapi administrator sign-in, not a content API token or end-user account. Optional automatic sign-in follows the login steps recorded for this application's single-page administrator form.",
  ],
  // Microsoft Exchange.
  [
    "Manual web login; native Exchange/Graph credentials are not an Outlook Web Access browser session.",
    "Optional automatic sign-in follows the login steps recorded for this application's web sign-in form; native Exchange/Graph credentials are not an Outlook Web Access browser session.",
  ],
];

/** Exposed for the test that keeps the table and the descriptions together. */
export const HTTP_APPLICATION_SIGN_IN_NOTES = SIGN_IN_NOTES;

function describeWithLoginSteps(description: string): string {
  const swapped = SIGN_IN_NOTES.reduce(
    (text, [manualOnly, withLoginSteps]) =>
      text.replace(manualOnly, () => withLoginSteps),
    description,
  );
  // A description with no known sentence still has to say what form mode does.
  return swapped === description
    ? `${description} ${AUTOMATIC_SIGN_IN}`
    : swapped;
}

/**
 * How active login steps relate to the login a profile already had.
 *
 * - `additive`: the profile signs in automatically today, by generic form
 *   detection. Its steps may only add coverage. They are tried first, and
 *   wherever they find nothing to act on (no step applies to the document, or
 *   a selector of an applicable step is missing before anything was typed)
 *   the existing detection runs exactly as it did, frames and saved overrides
 *   included. Steps are often narrower than what works today: the iLO steps
 *   know one frame layout, the VMware steps one sign-in product.
 * - `exclusive`: the profile had no automatic login. Only its steps may type;
 *   nothing falls back to form detection.
 *
 * Derived from the capability the profile has without steps, so a profile
 * that is automatic today can never be switched to `exclusive` by a steps
 * file.
 */
export type HttpLoginStepsMode = "additive" | "exclusive";

export function getHttpLoginStepsMode(
  profile: HttpApplicationProfile,
): HttpLoginStepsMode {
  return profile.capability === "manual" ? "exclusive" : "additive";
}

/**
 * The profile as the application offers it while its login steps are active.
 * `capability` is left alone on purpose: the engines read it to decide what
 * the single-form login may do, and steps are not a single form. An additive
 * profile also keeps its description and its login modes: what it did before
 * is still what it does where the steps do not apply.
 */
export function withDeclarativeLogin(
  profile: HttpApplicationProfile,
  steps: HttpLoginSteps,
): HttpApplicationProfile {
  const totpChallenges = [
    ...(profile.totpChallenges ?? []),
    ...(steps.totpChallenges ?? []),
  ];
  const mode = getHttpLoginStepsMode(profile);
  return {
    ...profile,
    ...(mode === "exclusive"
      ? {
          loginModes: ["manual", "form"] as const,
          description: describeWithLoginSteps(profile.description),
        }
      : {}),
    ...(totpChallenges.length ? { totpChallenges } : {}),
    declarativeLogin: steps,
    declarativeLoginMode: mode,
  };
}

/**
 * Where the first credential step runs, when that is not the page the
 * connection opens: another origin than the hosted address, or a path the
 * hosted address or the profile's login path does not satisfy. The login then
 * starts only once the tab has reached that page, by the site's own redirect
 * or by the user following its sign-in link. `undefined` when a step can run
 * on the opening page, or when that page is not known from the profile.
 */
export function getHttpLoginStepsEntryPage(
  profile: HttpApplicationProfile,
): string | undefined {
  const steps = profile.declarativeLogin;
  if (!steps) return undefined;
  const hosted = profile.hostedLoginUrl
    ? new URL(profile.hostedLoginUrl)
    : undefined;
  const openingPath = hosted?.pathname ?? profile.loginPath;
  let entry: string | undefined;
  for (const step of steps.loginSteps) {
    if (step.kind === "submit" || step.kind === "click") continue;
    const elsewhere =
      step.origin !== undefined && step.origin !== hosted?.origin;
    if (!elsewhere) {
      if (openingPath === undefined) return undefined;
      if (httpLoginStepMatchesPath(step, openingPath)) return undefined;
    }
    entry ??= `${elsewhere ? new URL(step.origin!).host : ""}${
      step.paths?.[0] ?? step.pathPrefixes?.[0] ?? ""
    }`;
  }
  return entry || undefined;
}
