/**
 * Declarative login steps: the reviewed, data-only description of how one
 * application's own sign-in page is filled (t102 contract L1).
 *
 * One file per application lives at `src/data/loginSteps/<family>/<id>.json`
 * and is checked by `validateHttpLoginSteps` (`utils/connection/httpLoginSteps`).
 * `httpLoginSteps.schema.json` beside this file is the published structural
 * contract; the validator additionally enforces the cross-field rules below.
 * A family directory holds steps files only: every `*.json` in it is read as
 * one. The fixture corpus (`tests/tooling/loginFixtureCorpus.node-test.mjs`,
 * rules in `tests/fixtures/logins/README.md`) further requires every selector
 * of a steps file to be cited in the application's `evidence.json` and to
 * match a fixture served where its step runs (same origin, path gate, frame).
 *
 * This format decides where a saved credential may be typed. It fails closed:
 * an unknown kind, an unknown field or any broken rule rejects the whole file,
 * and a rejected file is never used in part.
 *
 * Run-time contract for the engines (native and legacy):
 * 1. Each step has one exact origin: its `origin`, or the connection's own
 *    origin when it has none. Nothing is ever typed or clicked on an origin
 *    found at run time (a redirect target, a frame source, a link).
 * 2. A step applies to a document when the document's origin is the step's
 *    origin, its pathname passes the step's path gate, and the document is
 *    the step's `frame` (or the top document when the step has no `frame`).
 * 3. Steps run in file order. `identifier` receives the username only,
 *    `password` the password only, `form` both; `click` and `submit` receive
 *    no credential. Each credential is released at most once per origin.
 * 4. A `submit` runs in the document of the credential step directly before
 *    it, only after that step completed, and only when the user allows
 *    automatic submission (fill-only mode skips every `submit`).
 * 5. A selector or `waitFor` that does not match in time is a layout
 *    mismatch: the login stops with nothing further typed. Steps are never
 *    retried, skipped or reordered.
 *
 * No file field holds a secret, a value to type, script, or a URL to open.
 *
 * Not expressible, on purpose:
 * - a frame on another origin than its top document (t102 question Q8, not
 *   approved). `frame` is same-origin only;
 * - URL fragment gates (`#/signin/password`); `paths` see the pathname only;
 * - two alternative layouts on one origin (top document or frame): a
 *   credential has one step per origin. Alternative controls go in one
 *   selector list.
 *
 * Extending the format: add a new OPTIONAL field and leave `version` at 1.
 * Every existing file stays valid, and a validator or engine that predates
 * the field rejects any file using it as an unknown field, which is the
 * fail-closed direction. A cross-origin frame would be such a field on a
 * step: the top document's origin, beside `frame` and with `origin` naming
 * the frame's own origin, both listed in `credentialOrigins`. Change `version`
 * only when the meaning of an existing field changes.
 */

/** `click` is a pre-step (open a tab or dialog); `submit` sends what was typed. */
export type HttpLoginStepKind =
  "click" | "identifier" | "password" | "form" | "submit";

/**
 * How a `submit` step sends the fields:
 * - `click`: click the reviewed control of an ordinary POST form;
 * - `enter`: press Enter in the field the preceding step typed (the password
 *   field after `form`); it names no control;
 * - `spa`: click the reviewed button of a single-page form that has no POST
 *   action (a script handler, a `javascript:` action or a non-POST method).
 */
export type HttpLoginSubmission = "click" | "enter" | "spa";

/**
 * How the selectors were established (t102 section 1). `A`: from an
 * authoritative, cited source. `B`: an informed guess that nobody has
 * confirmed against the live page; `B` IS the "unverified" label, shown to the
 * user before they turn automatic login on. There is no separate flag to keep
 * in step with it. Class C applications have no steps file at all.
 */
export type HttpLoginEvidenceClass = "A" | "B";

/**
 * Repeats `class`, `source` and `reviewed` of the application's
 * `tests/fixtures/logins/<id>/evidence.json`, under the same names and in the
 * same formats, because the application cannot read test fixtures at run
 * time. That file is the full record; the corpus check
 * (`tests/tooling/loginFixtureCorpus.node-test.mjs`) keeps the two equal.
 */
export interface HttpLoginEvidence {
  class: HttpLoginEvidenceClass;
  /** The primary citation: a URL, a repository path or a capture name,
   * without spaces. Never free-form notes. */
  source: string;
  /** Calendar date of the review, `YYYY-MM-DD`. */
  reviewed: string;
}

/** Where a step may run. Every field narrows; none can widen the origin. */
export interface HttpLoginStepScope {
  /**
   * Exact origin (`https://host[:port]`, lower case, no default port, no
   * path) and it MUST also be listed in the file's `credentialOrigins`.
   * Omit it for the connection's own origin: for a hosted profile that is the
   * origin of the profile's `hostedLoginUrl`; for a self-hosted application it
   * is whatever host the user saved. HTTP is reachable only this way, and only
   * when the connection is explicitly configured for HTTP. The same holds for
   * an IP address, a single-label host and a name under a special-use or
   * private-use suffix (`HTTP_LOGIN_NON_PUBLIC_SUFFIXES`: `nas.local`,
   * `app.localhost`, `x.internal`): never written here, only ever reached as
   * the connection's own origin.
   */
  origin?: string;
  /** Exact pathnames (`location.pathname`), compared case-sensitively. */
  paths?: string[];
  /** Directory prefixes, each ending in `/`: matches that path and below. */
  pathPrefixes?: string[];
  /**
   * `id` or `name` of a direct child `<iframe>` of the top document whose
   * document has the same origin as the top document. The step then runs in
   * that frame and nowhere else. Cross-origin frames are not expressible.
   */
  frame?: string;
  /** CSS selector that must match in the step's document before it acts. */
  waitFor?: string;
}

/** Clicks one control before a credential step on the same origin. */
export interface HttpLoginClickStep extends HttpLoginStepScope {
  kind: "click";
  selectors: { control: string };
}

/** Types the username only (identifier-first sign-in). */
export interface HttpLoginIdentifierStep extends HttpLoginStepScope {
  kind: "identifier";
  selectors: { username: string };
}

/** Types the password only. */
export interface HttpLoginPasswordStep extends HttpLoginStepScope {
  kind: "password";
  selectors: { password: string };
}

/** Types the username and the password into one form. */
export interface HttpLoginFormStep extends HttpLoginStepScope {
  kind: "form";
  selectors: { username: string; password: string };
}

export type HttpLoginCredentialStep =
  HttpLoginIdentifierStep | HttpLoginPasswordStep | HttpLoginFormStep;

/**
 * Submits the credential step directly before it, in that step's document.
 * It therefore has no `origin`, `paths`, `pathPrefixes` or `frame` of its own.
 */
export interface HttpLoginSubmitControlStep {
  kind: "submit";
  submission: "click" | "spa";
  selectors: { control: string };
  waitFor?: string;
}

export interface HttpLoginSubmitEnterStep {
  kind: "submit";
  submission: "enter";
  waitFor?: string;
}

export type HttpLoginSubmitStep =
  HttpLoginSubmitControlStep | HttpLoginSubmitEnterStep;

export type HttpLoginStep =
  HttpLoginClickStep | HttpLoginCredentialStep | HttpLoginSubmitStep;

/** Only the two generic challenge runtimes; provider-specific ones stay coded. */
export type HttpLoginTotpSubmission = "post" | "spa";

/**
 * A reviewed authenticator-code challenge, in the catalog's existing shape
 * (`HttpApplicationTotpChallenge`) so it can be copied into a profile as is.
 * `paths` are exact, as they already are in the native TOTP authority.
 */
export interface HttpLoginTotpChallenge {
  id: string;
  label: string;
  codeSelector: string;
  submitSelector: string;
  paths: string[];
  submission: HttpLoginTotpSubmission;
  /** Restricts the challenge to these listed credential origins. Without it
   * the challenge belongs to the connection's own origin. */
  origins?: string[];
}

/** The validated, normalized content of one steps file. */
export interface HttpLoginSteps {
  version: 1;
  /** Application profile id; equal to the file's base name. */
  id: string;
  evidence: HttpLoginEvidence;
  /**
   * Every origin other than the connection's own on which a step may run.
   * Required even when empty: `[]` states that credentials go to the
   * connection's own origin and nowhere else. HTTPS public DNS names only
   * (no special-use or private-use suffix), and each entry must be used by a
   * step or a challenge.
   */
  credentialOrigins: string[];
  /** A device with no username: only `click`, `password` and `submit` steps. */
  passwordOnly: boolean;
  loginSteps: HttpLoginStep[];
  totpChallenges?: HttpLoginTotpChallenge[];
}

/** A steps file as written: `passwordOnly` defaults to false. */
export type HttpLoginStepsFile = Omit<HttpLoginSteps, "passwordOnly"> & {
  $schema?: "../../../types/connection/httpLoginSteps.schema.json";
  passwordOnly?: boolean;
};

/**
 * The steps of a user-configured profile (`custom`), built from the user's
 * own selectors. There is no evidence to cite and no origin list: every step
 * runs on the connection's own origin, and a step naming an `origin` is
 * refused. Checked by `validateUserHttpLoginSteps`.
 */
export type HttpLoginUserSteps = Pick<
  HttpLoginSteps,
  "passwordOnly" | "loginSteps"
>;

export type HttpLoginStepsIssueCode =
  // Structure and bounds; the JSON schema rejects these as well.
  | "not-an-object"
  | "unknown-field"
  | "missing-field"
  | "invalid-type"
  | "invalid-version"
  | "invalid-schema-ref"
  | "invalid-id"
  | "invalid-evidence"
  | "invalid-list"
  | "duplicate-entry"
  | "invalid-origin"
  | "insecure-origin"
  | "invalid-kind"
  | "invalid-submission"
  | "invalid-selector"
  | "invalid-path"
  | "invalid-path-prefix"
  | "invalid-frame"
  | "invalid-label"
  | "password-only-kind"
  // Cross-field rules; only the validator can express these.
  | "id-mismatch"
  | "impossible-date"
  | "origin-not-listed"
  | "unused-credential-origin"
  | "no-credential-step"
  | "password-without-identifier"
  | "duplicate-credential-step"
  | "click-without-credential-step"
  | "submit-without-credential-step"
  | "submit-not-adjacent"
  | "submit-per-origin"
  | "duplicate-totp-id"
  // Only from `resolveHttpLoginSteps`.
  | "invalid-connection-origin"
  | "insecure-connection-origin";

/** `path` names a field (`loginSteps[2].origin`); `message` is a fixed
 * sentence per rule. Neither ever contains text copied from the file. */
export interface HttpLoginStepsIssue {
  code: HttpLoginStepsIssueCode;
  path: string;
  message: string;
}

export type HttpLoginStepsResult<T> =
  { ok: true; value: T } | { ok: false; issues: HttpLoginStepsIssue[] };

/** What a `submit` step sends: the stage of the step it follows. */
export type HttpLoginSubmitStage = "identifier" | "password" | "form";

/** One step with nothing left implicit, for one connection. */
export interface ResolvedHttpLoginStep {
  /** Position in the file's `loginSteps`. */
  index: number;
  kind: HttpLoginStepKind;
  /** Concrete origin; never empty. */
  origin: string;
  /** Empty together with `pathPrefixes` means any path of the origin. */
  paths: string[];
  pathPrefixes: string[];
  /** Null means the top document. */
  frame: string | null;
  waitFor: string | null;
  selectors: { username?: string; password?: string; control?: string };
  /** `submit` steps only. */
  submission?: HttpLoginSubmission;
  /** `submit` steps only. */
  submits?: HttpLoginSubmitStage;
}

/** The saved connection facts resolution needs; never taken from a page. */
export interface HttpLoginStepsConnection {
  /** The saved connection's exact origin (scheme, host and port). */
  connectionOrigin: string;
  /** `configuredHttpCredentialOrigin(connection)`: the one HTTP origin the
   * user explicitly configured, if any. */
  configuredHttpOrigin?: string | null;
}

/** What runs where for one connection. File metadata (id, evidence) is not
 * repeated here: it stays with the validated file. */
export interface ResolvedHttpLoginSteps {
  passwordOnly: boolean;
  connectionOrigin: string;
  /** The complete allowlist: every origin a step runs on, and nothing else. */
  credentialOrigins: string[];
  /** True when a step runs on an origin other than the connection's own;
   * such a login is native-only and the legacy engine must refuse it. */
  crossOrigin: boolean;
  steps: ResolvedHttpLoginStep[];
}
