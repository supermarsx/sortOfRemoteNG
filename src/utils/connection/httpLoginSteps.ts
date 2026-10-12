import type {
  HttpLoginEvidence,
  HttpLoginEvidenceClass,
  HttpLoginStep,
  HttpLoginStepKind,
  HttpLoginSteps,
  HttpLoginStepsConnection,
  HttpLoginStepsIssue,
  HttpLoginStepsIssueCode,
  HttpLoginStepsResult,
  HttpLoginSubmission,
  HttpLoginSubmitStage,
  HttpLoginTotpChallenge,
  HttpLoginUserSteps,
  HttpLoginTotpSubmission,
  ResolvedHttpLoginStep,
  ResolvedHttpLoginSteps,
} from "../../types/connection/httpLoginSteps";

/**
 * Validator for declarative login steps (t102 contract L1). The format and
 * its run-time contract are documented in `types/connection/httpLoginSteps`.
 *
 * Fails closed: anything unknown or out of bounds rejects the whole file.
 * Keep this module free of run-time imports and of non-erasable TypeScript
 * (enums, namespaces, parameter properties): `node --test` suites and scripts
 * import it directly, without a bundler.
 */

/** Where the per-application files live, relative to the repository root. */
export const HTTP_LOGIN_STEPS_DIRECTORY = "src/data/loginSteps";
/** The only `$schema` value a steps file may carry (from `<family>/<id>.json`). */
export const HTTP_LOGIN_STEPS_SCHEMA_REF =
  "../../../types/connection/httpLoginSteps.schema.json";

const KINDS: Record<HttpLoginStepKind, true> = {
  click: true,
  identifier: true,
  password: true,
  form: true,
  submit: true,
};
const SUBMISSIONS: Record<HttpLoginSubmission, true> = {
  click: true,
  enter: true,
  spa: true,
};
const TOTP_SUBMISSIONS: Record<HttpLoginTotpSubmission, true> = {
  post: true,
  spa: true,
};
const EVIDENCE_CLASSES: Record<HttpLoginEvidenceClass, true> = {
  A: true,
  B: true,
};
export const HTTP_LOGIN_STEP_KINDS = Object.keys(
  KINDS,
) as readonly HttpLoginStepKind[];
export const HTTP_LOGIN_SUBMISSIONS = Object.keys(
  SUBMISSIONS,
) as readonly HttpLoginSubmission[];
export const HTTP_LOGIN_TOTP_SUBMISSIONS = Object.keys(
  TOTP_SUBMISSIONS,
) as readonly HttpLoginTotpSubmission[];
export const HTTP_LOGIN_EVIDENCE_CLASSES = Object.keys(
  EVIDENCE_CLASSES,
) as readonly HttpLoginEvidenceClass[];

/**
 * Suffixes under which no name is a public DNS name, so none can be a listed
 * credential origin: `a.localhost` is this machine in Chromium, `nas.local` is
 * whatever answers on the local network. First the IANA special-use names
 * (all of `arpa`, which includes `home.arpa`), then the private-use suffixes
 * that `classifyHost` in `scripts/capture-login-page.mjs` also refuses, plus
 * `mail`, which with `home` and `corp` is never to be delegated. Keep this
 * list at least as strict as that one; the schema's origin pattern names the
 * same suffixes.
 */
export const HTTP_LOGIN_NON_PUBLIC_SUFFIXES: readonly string[] = Object.freeze([
  "localhost",
  "local",
  "test",
  "invalid",
  "example",
  "onion",
  "alt",
  "internal",
  "arpa",
  "localdomain",
  "lan",
  "home",
  "corp",
  "mail",
  "intranet",
  "private",
]);

/** The selector, frame, path and origin bounds are the engines' existing ones. */
export const HTTP_LOGIN_STEPS_LIMITS = Object.freeze({
  steps: 16,
  credentialOrigins: 8,
  paths: 16,
  totpChallenges: 8,
  /** UTF-16 units, as the native and legacy clients count them. */
  selectorLength: 512,
  originLength: 512,
  pathLength: 512,
  frameLength: 128,
  idLength: 80,
  labelLength: 120,
  sourceLength: 512,
});

/** Rules the JSON schema cannot express: a file can satisfy the schema and
 * still be refused for one of these. */
export const HTTP_LOGIN_STEPS_VALIDATOR_ONLY_CODES: readonly HttpLoginStepsIssueCode[] =
  [
    "id-mismatch",
    "impossible-date",
    "origin-not-listed",
    "unused-credential-origin",
    "no-credential-step",
    "password-without-identifier",
    "duplicate-credential-step",
    "click-without-credential-step",
    "submit-without-credential-step",
    "submit-not-adjacent",
    "submit-per-origin",
    "duplicate-totp-id",
    "invalid-connection-origin",
    "insecure-connection-origin",
  ];

const MESSAGES: Record<HttpLoginStepsIssueCode, string> = {
  "not-an-object": "Expected a plain JSON object.",
  "unknown-field": "This field is not part of the login steps format.",
  "missing-field": "A required field is missing.",
  "invalid-type": "This field has the wrong JSON type.",
  "invalid-version": "version must be the number 1.",
  "invalid-schema-ref":
    "$schema may only reference the login steps schema of this repository.",
  "invalid-id": "The id is missing or is not a valid identifier.",
  "invalid-evidence":
    "evidence needs class A or B, a cited source and a YYYY-MM-DD date.",
  "invalid-list": "Expected a list within its allowed size.",
  "duplicate-entry": "This list repeats an entry.",
  "invalid-origin":
    "Expected an exact HTTPS origin of a public DNS name: lower case, no path, no default port, and not under a special-use or private-use suffix such as .localhost, .local or .internal.",
  "insecure-origin":
    "A steps file may only name HTTPS origins. HTTP is reached only as the connection's own configured origin.",
  "invalid-kind": "kind must be click, identifier, password, form or submit.",
  "invalid-submission": "submission is missing or not allowed here.",
  "invalid-selector":
    "A selector must be 1 to 512 characters without control characters or surrounding spaces.",
  "invalid-path": "Expected a safe absolute pathname.",
  "invalid-path-prefix":
    "Expected a safe directory prefix that ends in a slash and is not the root.",
  "invalid-frame":
    "frame must be 1 to 128 letters, digits, underscores or hyphens.",
  "invalid-label": "The label is missing, too long or not plain text.",
  "password-only-kind":
    "A passwordOnly file may not contain an identifier or form step.",
  "id-mismatch": "The id does not match the file name.",
  "impossible-date": "The review date is not a real calendar date.",
  "origin-not-listed": "This origin is not listed in credentialOrigins.",
  "unused-credential-origin":
    "credentialOrigins lists an origin that no step or challenge uses.",
  "no-credential-step":
    "The steps type no credential: an identifier, password or form step is required.",
  "password-without-identifier":
    "A password step needs an earlier identifier or form step unless passwordOnly is true.",
  "duplicate-credential-step":
    "The username and the password may each be typed by only one step per origin.",
  "click-without-credential-step":
    "A click is a pre-step: a credential step on the same origin must follow it.",
  "submit-without-credential-step":
    "A submit must follow the identifier, password or form step it submits.",
  "submit-not-adjacent":
    "A submit must come directly after the step it submits.",
  "submit-per-origin":
    "Only one submit per origin is allowed for the identifier and one for the password.",
  "duplicate-totp-id": "Two challenges share an id.",
  "invalid-connection-origin":
    "The connection origin is not an exact http or https origin.",
  "insecure-connection-origin":
    "Login steps run over HTTP only on the connection's own configured HTTP origin.",
};

const MAX_ISSUES = 64;
type Raw = Record<string, unknown>;
type Report = (code: HttpLoginStepsIssueCode, path: string) => void;
type ScopedStep = Exclude<HttpLoginStep, { kind: "submit" }>;

function collector(): { issues: HttpLoginStepsIssue[]; report: Report } {
  const issues: HttpLoginStepsIssue[] = [];
  return {
    issues,
    report: (code, path) => {
      if (issues.length < MAX_ISSUES)
        issues.push({ code, path, message: MESSAGES[code] });
    },
  };
}

/**
 * JSON objects only: no arrays, class instances or foreign prototypes.
 * Returns a shallow copy so every field is read exactly once: what was
 * checked is what is returned, even for an object with accessors.
 */
function plainObject(value: unknown): Raw | null {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  return { ...(value as Raw) };
}

/** A list within its size bounds, copied so each entry is read once. A list
 * of the wrong size is never iterated. */
function boundedList(
  value: unknown,
  min: number,
  max: number,
): unknown[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    return null;
  return Array.from(value as unknown[]);
}
const has = (record: Raw, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);
const join = (path: string, key: string) => (path ? `${path}.${key}` : key);

/** An own `__proto__` key from JSON.parse is reported like any other key. */
function rejectUnknownFields(
  record: Raw,
  allowed: readonly string[],
  path: string,
  report: Report,
): void {
  for (const key of Object.keys(record))
    if (!allowed.includes(key))
      // Echo a field name only when it is a short identifier.
      report(
        "unknown-field",
        join(path, /^[$A-Za-z_][$\w]{0,63}$/.test(key) ? key : "(unknown)"),
      );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

/** Selector-shaped text: bounded, printable, no surrounding spaces. */
function isBoundedText(value: unknown, limit: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= limit &&
    !hasControlCharacter(value) &&
    value[0] !== " " &&
    value[value.length - 1] !== " "
  );
}
const isSelector = (value: unknown): value is string =>
  isBoundedText(value, HTTP_LOGIN_STEPS_LIMITS.selectorLength);

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A name is not public when its last label is a special-use or private-use
 * suffix. Whole labels only, in any letter case: `x.local` and `a.localhost`
 * are refused, `notlocal.com` and `local.example.com` are not.
 */
function isNonPublicName(host: string): boolean {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".");
  return HTTP_LOGIN_NON_PUBLIC_SUFFIXES.includes(labels[labels.length - 1]);
}

/**
 * A listed origin is a public DNS name. An IP literal, a single-label host
 * and any name under a special-use or private-use suffix (`localhost` and
 * every name below it, `local`, `internal`, ...) can only ever be a
 * connection's own origin, which a step reaches by omitting `origin`; none of
 * them can be written into a file.
 */
function originIssue(
  value: unknown,
): "invalid-origin" | "insecure-origin" | null {
  if (
    typeof value !== "string" ||
    value.length > HTTP_LOGIN_STEPS_LIMITS.originLength
  )
    return "invalid-origin";
  if (value.slice(0, 7).toLowerCase() === "http://") return "insecure-origin";
  if (!value.startsWith("https://")) return "invalid-origin";
  const authority = value.slice(8);
  const colon = authority.indexOf(":");
  const host = colon < 0 ? authority : authority.slice(0, colon);
  if (isNonPublicName(host)) return "invalid-origin";
  const labels = host.split(".");
  if (
    host.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => DNS_LABEL.test(label)) ||
    !/^[a-z]/.test(labels[labels.length - 1])
  )
    return "invalid-origin";
  if (colon >= 0) {
    const port = authority.slice(colon + 1);
    if (!/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535)
      return "invalid-origin";
  }
  try {
    // Exact, already-canonical origins only: this also refuses `:443`.
    if (new URL(value).origin !== value) return "invalid-origin";
  } catch {
    return "invalid-origin";
  }
  return null;
}

const PATH_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** Pathname only: no query, fragment, encoding, empty or dot segment. */
function isSafePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length > HTTP_LOGIN_STEPS_LIMITS.pathLength ||
    value[0] !== "/"
  )
    return false;
  const segments = value.slice(1).split("/");
  return segments.every((segment, index) =>
    segment === ""
      ? index === segments.length - 1
      : PATH_SEGMENT.test(segment) && segment !== "." && segment !== "..",
  );
}
const isSafePathPrefix = (value: unknown): value is string =>
  isSafePath(value) && value.length > 1 && value.endsWith("/");

/** Reads a bounded list of unique strings. */
function readStrings(
  value: unknown,
  path: string,
  bounds: { min: number; max: number },
  entryIssue: (entry: unknown) => HttpLoginStepsIssueCode | null,
  report: Report,
): string[] {
  const list = boundedList(value, bounds.min, bounds.max);
  if (!list) {
    report("invalid-list", path);
    return [];
  }
  const entries: string[] = [];
  list.forEach((entry, index) => {
    const issue = entryIssue(entry);
    if (issue) report(issue, `${path}[${index}]`);
    else if (entries.includes(entry as string))
      report("duplicate-entry", `${path}[${index}]`);
    else entries.push(entry as string);
  });
  return entries;
}

function readEvidence(
  input: unknown,
  report: Report,
): HttpLoginEvidence | null {
  const value = plainObject(input);
  if (!value) {
    report("not-an-object", "evidence");
    return null;
  }
  rejectUnknownFields(
    value,
    ["class", "source", "reviewed"],
    "evidence",
    report,
  );
  const valid: Record<keyof HttpLoginEvidence, (field: unknown) => boolean> = {
    class: (field) => typeof field === "string" && has(EVIDENCE_CLASSES, field),
    // A citation (URL, repository path or capture name), never prose: the
    // same rule as `citation` in tests/fixtures/logins/evidence.schema.json.
    source: (field) =>
      isBoundedText(field, HTTP_LOGIN_STEPS_LIMITS.sourceLength) &&
      !field.includes(" "),
    reviewed: (field) =>
      typeof field === "string" &&
      /^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/.test(field),
  };
  let complete = true;
  for (const key of ["class", "source", "reviewed"] as const) {
    if (has(value, key) && valid[key](value[key])) continue;
    report(
      has(value, key) ? "invalid-evidence" : "missing-field",
      `evidence.${key}`,
    );
    complete = false;
  }
  return complete
    ? {
        class: value.class as HttpLoginEvidenceClass,
        source: value.source as string,
        reviewed: value.reviewed as string,
      }
    : null;
}

const SELECTORS_BY_KIND: Record<
  HttpLoginStepKind,
  readonly ("username" | "password" | "control")[]
> = {
  click: ["control"],
  identifier: ["username"],
  password: ["password"],
  form: ["username", "password"],
  submit: ["control"],
};
const SCOPE_FIELDS = ["origin", "paths", "pathPrefixes", "frame"] as const;

function readStep(
  input: unknown,
  path: string,
  passwordOnly: boolean,
  report: Report,
): HttpLoginStep | null {
  const value = plainObject(input);
  if (!value) {
    report("not-an-object", path);
    return null;
  }
  const kind = value.kind;
  if (typeof kind !== "string" || !has(KINDS, kind)) {
    report("invalid-kind", join(path, "kind"));
    return null;
  }
  const step: Raw = { kind };
  if (passwordOnly && (kind === "identifier" || kind === "form"))
    report("password-only-kind", join(path, "kind"));

  let selectorKeys = SELECTORS_BY_KIND[kind as HttpLoginStepKind];
  if (kind === "submit") {
    const submission = value.submission;
    if (typeof submission === "string" && has(SUBMISSIONS, submission)) {
      step.submission = submission;
      // Enter is pressed in the field just typed, so it names no control.
      if (submission === "enter") selectorKeys = [];
    } else report("invalid-submission", join(path, "submission"));
    // A submit runs in its credential step's document: no scope of its own.
    rejectUnknownFields(
      value,
      [
        "kind",
        "submission",
        "waitFor",
        ...(selectorKeys.length ? ["selectors"] : []),
      ],
      path,
      report,
    );
  } else {
    rejectUnknownFields(
      value,
      ["kind", ...SCOPE_FIELDS, "waitFor", "selectors"],
      path,
      report,
    );
    if (has(value, "origin")) {
      const issue = originIssue(value.origin);
      if (issue) report(issue, join(path, "origin"));
      else step.origin = value.origin;
    }
    const lists = [
      ["paths", isSafePath, "invalid-path"],
      ["pathPrefixes", isSafePathPrefix, "invalid-path-prefix"],
    ] as const;
    for (const [key, valid, code] of lists)
      if (has(value, key))
        step[key] = readStrings(
          value[key],
          join(path, key),
          { min: 1, max: HTTP_LOGIN_STEPS_LIMITS.paths },
          (entry) => (valid(entry) ? null : code),
          report,
        );
    if (has(value, "frame")) {
      if (
        typeof value.frame === "string" &&
        value.frame.length <= HTTP_LOGIN_STEPS_LIMITS.frameLength &&
        /^[A-Za-z0-9_-]+$/.test(value.frame)
      )
        step.frame = value.frame;
      else report("invalid-frame", join(path, "frame"));
    }
  }
  if (has(value, "waitFor")) {
    if (isSelector(value.waitFor)) step.waitFor = value.waitFor;
    else report("invalid-selector", join(path, "waitFor"));
  }
  if (selectorKeys.length) {
    const selectorsPath = join(path, "selectors");
    const written = plainObject(value.selectors);
    if (!has(value, "selectors")) report("missing-field", selectorsPath);
    else if (!written) report("not-an-object", selectorsPath);
    else {
      const selectors: Raw = {};
      rejectUnknownFields(written, selectorKeys, selectorsPath, report);
      for (const key of selectorKeys) {
        if (!has(written, key))
          report("missing-field", join(selectorsPath, key));
        else if (!isSelector(written[key]))
          report("invalid-selector", join(selectorsPath, key));
        else selectors[key] = written[key];
      }
      step.selectors = selectors;
    }
  }
  return step as unknown as HttpLoginStep;
}

function readTotpChallenge(
  input: unknown,
  path: string,
  report: Report,
): HttpLoginTotpChallenge | null {
  const value = plainObject(input);
  if (!value) {
    report("not-an-object", path);
    return null;
  }
  const required = [
    "id",
    "label",
    "codeSelector",
    "submitSelector",
    "paths",
    "submission",
  ] as const;
  rejectUnknownFields(value, [...required, "origins"], path, report);
  let complete = true;
  for (const key of required)
    if (!has(value, key)) {
      report("missing-field", join(path, key));
      complete = false;
    }
  if (!complete) return null;
  if (typeof value.id !== "string" || !/^[a-z0-9-]{1,128}$/.test(value.id))
    report("invalid-id", join(path, "id"));
  if (!isBoundedText(value.label, HTTP_LOGIN_STEPS_LIMITS.labelLength))
    report("invalid-label", join(path, "label"));
  for (const key of ["codeSelector", "submitSelector"] as const)
    if (!isSelector(value[key])) report("invalid-selector", join(path, key));
  if (
    typeof value.submission !== "string" ||
    !has(TOTP_SUBMISSIONS, value.submission)
  )
    report("invalid-submission", join(path, "submission"));
  const challenge: HttpLoginTotpChallenge = {
    id: value.id as string,
    label: value.label as string,
    codeSelector: value.codeSelector as string,
    submitSelector: value.submitSelector as string,
    paths: readStrings(
      value.paths,
      join(path, "paths"),
      { min: 1, max: HTTP_LOGIN_STEPS_LIMITS.paths },
      (entry) => (isSafePath(entry) ? null : "invalid-path"),
      report,
    ),
    submission: value.submission as HttpLoginTotpSubmission,
  };
  if (has(value, "origins"))
    challenge.origins = readStrings(
      value.origins,
      join(path, "origins"),
      { min: 1, max: HTTP_LOGIN_STEPS_LIMITS.credentialOrigins },
      originIssue,
      report,
    );
  return challenge;
}

function readSteps(
  value: Raw,
  passwordOnly: boolean,
  report: Report,
): HttpLoginStep[] {
  const loginSteps: HttpLoginStep[] = [];
  const rawSteps = boundedList(
    value.loginSteps,
    1,
    HTTP_LOGIN_STEPS_LIMITS.steps,
  );
  if (!has(value, "loginSteps")) report("missing-field", "loginSteps");
  else if (!rawSteps) report("invalid-list", "loginSteps");
  else
    rawSteps.forEach((raw, index) => {
      const step = readStep(raw, `loginSteps[${index}]`, passwordOnly, report);
      if (step) loginSteps.push(step);
    });
  return loginSteps;
}

/** `passwordOnly` is false unless it is the boolean true. */
function readPasswordOnly(value: Raw, report: Report): boolean {
  if (has(value, "passwordOnly") && typeof value.passwordOnly !== "boolean")
    report("invalid-type", "passwordOnly");
  return value.passwordOnly === true;
}

/** Structure and bounds: everything the JSON schema also says. */
function readFile(input: unknown, report: Report): HttpLoginSteps | null {
  const value = plainObject(input);
  if (!value) {
    report("not-an-object", "");
    return null;
  }
  rejectUnknownFields(
    value,
    [
      "$schema",
      "version",
      "id",
      "evidence",
      "credentialOrigins",
      "passwordOnly",
      "loginSteps",
      "totpChallenges",
    ],
    "",
    report,
  );
  if (has(value, "$schema") && value.$schema !== HTTP_LOGIN_STEPS_SCHEMA_REF)
    report("invalid-schema-ref", "$schema");
  if (value.version !== 1) report("invalid-version", "version");
  if (
    typeof value.id !== "string" ||
    value.id.length > HTTP_LOGIN_STEPS_LIMITS.idLength ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(value.id)
  )
    report("invalid-id", "id");
  const passwordOnly = readPasswordOnly(value, report);

  let evidence: HttpLoginEvidence | null = null;
  if (has(value, "evidence")) evidence = readEvidence(value.evidence, report);
  else report("missing-field", "evidence");
  // Required even when empty, so the allowlist is always an explicit statement.
  let credentialOrigins: string[] = [];
  if (has(value, "credentialOrigins"))
    credentialOrigins = readStrings(
      value.credentialOrigins,
      "credentialOrigins",
      { min: 0, max: HTTP_LOGIN_STEPS_LIMITS.credentialOrigins },
      originIssue,
      report,
    );
  else report("missing-field", "credentialOrigins");

  const loginSteps = readSteps(value, passwordOnly, report);

  let totpChallenges: HttpLoginTotpChallenge[] | undefined;
  if (has(value, "totpChallenges")) {
    const rawChallenges = boundedList(
      value.totpChallenges,
      1,
      HTTP_LOGIN_STEPS_LIMITS.totpChallenges,
    );
    if (!rawChallenges) report("invalid-list", "totpChallenges");
    else {
      const challenges: HttpLoginTotpChallenge[] = [];
      rawChallenges.forEach((raw, index) => {
        const challenge = readTotpChallenge(
          raw,
          `totpChallenges[${index}]`,
          report,
        );
        if (challenge) challenges.push(challenge);
      });
      totpChallenges = challenges;
    }
  }
  if (!evidence) return null;
  return {
    version: 1,
    id: value.id as string,
    evidence,
    credentialOrigins,
    passwordOnly,
    loginSteps,
    ...(totpChallenges ? { totpChallenges } : {}),
  };
}

const isCredentialKind = (kind: HttpLoginStepKind) =>
  kind === "identifier" || kind === "password" || kind === "form";

/**
 * The order rules, per exact origin. Run once on the file (where every step
 * without an `origin` shares one unnamed origin) and again by
 * `resolveHttpLoginSteps`, because a listed origin can turn out to be the
 * connection's own.
 */
function checkSequence(
  steps: readonly { kind: HttpLoginStepKind; origin: string }[],
  passwordOnly: boolean,
  report: Report,
): void {
  const at = (index: number) => `loginSteps[${index}]`;
  if (!steps.some((step) => isCredentialKind(step.kind)))
    report("no-credential-step", "loginSteps");
  const typed = new Set<string>();
  const submitted = new Set<string>();
  let usernameSeen = false;
  let credentialIndex = -1;
  steps.forEach((step, index) => {
    if (isCredentialKind(step.kind)) {
      // Each credential is typed by at most one step per origin.
      const fields =
        step.kind === "form"
          ? ["username", "password"]
          : [step.kind === "identifier" ? "username" : "password"];
      if (fields.some((field) => typed.has(`${field} ${step.origin}`)))
        report("duplicate-credential-step", at(index));
      for (const field of fields) typed.add(`${field} ${step.origin}`);
      if (step.kind === "password" && !usernameSeen && !passwordOnly)
        report("password-without-identifier", at(index));
      if (step.kind !== "password") usernameSeen = true;
      credentialIndex = index;
    } else if (step.kind === "click") {
      // A pre-step only: anything after the last credential step on its
      // origin would be post-login automation.
      const prepares = steps.some(
        (later, laterIndex) =>
          laterIndex > index &&
          isCredentialKind(later.kind) &&
          later.origin === step.origin,
      );
      if (!prepares) report("click-without-credential-step", at(index));
    } else if (credentialIndex < 0) {
      report("submit-without-credential-step", at(index));
    } else {
      const submits = steps[credentialIndex];
      // One submit carrying the password and one carrying only the
      // identifier per origin: the engines' one-shot submit grants.
      const stage = submits.kind === "identifier" ? "identifier" : "password";
      if (submitted.has(`${stage} ${submits.origin}`))
        report("submit-per-origin", at(index));
      submitted.add(`${stage} ${submits.origin}`);
      if (credentialIndex !== index - 1)
        report("submit-not-adjacent", at(index));
    }
  });
}

/**
 * The origin and order rules shared by a catalog file and a user-configured
 * profile; only run on structurally valid steps.
 */
function checkPlan(
  file: Pick<
    HttpLoginSteps,
    "credentialOrigins" | "passwordOnly" | "loginSteps" | "totpChallenges"
  >,
  report: Report,
): void {
  // Credentials are released only to listed exact origins.
  const used = new Set<string>();
  file.loginSteps.forEach((step, index) => {
    if (step.kind === "submit" || step.origin === undefined) return;
    used.add(step.origin);
    if (!file.credentialOrigins.includes(step.origin))
      report("origin-not-listed", `loginSteps[${index}].origin`);
  });
  const challengeIds = new Set<string>();
  (file.totpChallenges ?? []).forEach((challenge, index) => {
    if (challengeIds.has(challenge.id))
      report("duplicate-totp-id", `totpChallenges[${index}].id`);
    challengeIds.add(challenge.id);
    (challenge.origins ?? []).forEach((origin, originIndex) => {
      used.add(origin);
      if (!file.credentialOrigins.includes(origin))
        report(
          "origin-not-listed",
          `totpChallenges[${index}].origins[${originIndex}]`,
        );
    });
  });
  // The allowlist is never wider than what the steps use.
  file.credentialOrigins.forEach((origin, index) => {
    if (!used.has(origin))
      report("unused-credential-origin", `credentialOrigins[${index}]`);
  });

  checkSequence(
    file.loginSteps.map((step) => ({
      kind: step.kind,
      origin: step.kind === "submit" ? "" : (step.origin ?? ""),
    })),
    file.passwordOnly,
    report,
  );
}

/**
 * Checks one steps file. Never throws. `options.id` is the id the file name
 * promises. On success `value` is a normalized copy (`passwordOnly` filled
 * in, `$schema` dropped); the input is not modified.
 */
export function validateHttpLoginSteps(
  value: unknown,
  options: { id?: string } = {},
): HttpLoginStepsResult<HttpLoginSteps> {
  const { issues, report } = collector();
  const file = readFile(value, report);
  if (file && issues.length === 0) {
    if (options.id !== undefined && file.id !== options.id)
      report("id-mismatch", "id");
    const [year, month, day] = file.evidence.reviewed.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
      report("impossible-date", "evidence.reviewed");
    checkPlan(file, report);
  }
  return file && issues.length === 0
    ? { ok: true, value: file }
    : { ok: false, issues };
}

/**
 * Checks the steps a user configured for their own website (the `custom`
 * profile). The step rules are the same; the envelope is only
 * `{ passwordOnly?, loginSteps }`, because there is no evidence to cite and
 * no other origin to list: a step that names an `origin` is refused, so
 * these steps can only ever run on the connection's own origin.
 */
export function validateUserHttpLoginSteps(
  value: unknown,
): HttpLoginStepsResult<HttpLoginUserSteps> {
  const { issues, report } = collector();
  const record = plainObject(value);
  if (!record) {
    report("not-an-object", "");
    return { ok: false, issues };
  }
  rejectUnknownFields(record, ["passwordOnly", "loginSteps"], "", report);
  const passwordOnly = readPasswordOnly(record, report);
  const loginSteps = readSteps(record, passwordOnly, report);
  if (issues.length === 0)
    checkPlan({ credentialOrigins: [], passwordOnly, loginSteps }, report);
  return issues.length === 0
    ? { ok: true, value: { passwordOnly, loginSteps } }
    : { ok: false, issues };
}

/** Throws rule codes and field paths only, never text from the file. */
export function assertHttpLoginSteps(
  value: unknown,
  options: { id?: string } = {},
): HttpLoginSteps {
  const result = validateHttpLoginSteps(value, options);
  if (result.ok) return result.value;
  throw new Error(
    `Invalid login steps: ${result.issues
      .map((issue) => `${issue.code} at ${issue.path || "(file)"}`)
      .join("; ")}`,
  );
}

/** Class B is the "unverified layout" label; anything but A counts. */
export function isUnverifiedHttpLoginSteps(file: {
  evidence: { class: HttpLoginEvidenceClass };
}): boolean {
  return file.evidence.class !== "A";
}

/**
 * The reference path gate. `pathname` is the document's `location.pathname`,
 * compared as is: no decoding, case folding or normalization. A step with no
 * gate runs on any path of its origin.
 */
export function httpLoginStepMatchesPath(
  step: { paths?: readonly string[]; pathPrefixes?: readonly string[] },
  pathname: string,
): boolean {
  if (typeof pathname !== "string" || pathname[0] !== "/") return false;
  const paths = step.paths ?? [];
  const prefixes = step.pathPrefixes ?? [];
  if (paths.length === 0 && prefixes.length === 0) return true;
  return (
    paths.includes(pathname) ||
    prefixes.some(
      (prefix) => prefix.endsWith("/") && pathname.startsWith(prefix),
    )
  );
}

/** An exact http(s) origin as the saved connection has it; private hosts,
 * IP literals and custom ports are normal here. */
function isConnectionOrigin(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.origin === value
    );
  } catch {
    return false;
  }
}

/**
 * Resolves a steps file for one saved connection: every step gets its
 * concrete origin and every submit the scope and stage of the step it
 * submits. This is the reference for what runs where; an engine works from
 * this shape (or mirrors it), never from the raw file.
 *
 * `connection` must come from the saved connection, never from a page. An
 * HTTP connection origin is accepted only when it is exactly the configured
 * HTTP origin; the per-origin rules are re-checked with the real origin.
 */
export function resolveHttpLoginSteps(
  value: unknown,
  connection: HttpLoginStepsConnection,
): HttpLoginStepsResult<ResolvedHttpLoginSteps> {
  const validated = validateHttpLoginSteps(value);
  return validated.ok ? resolvePlan(validated.value, connection) : validated;
}

/** The same resolution for a user-configured profile's steps. */
export function resolveUserHttpLoginSteps(
  value: unknown,
  connection: HttpLoginStepsConnection,
): HttpLoginStepsResult<ResolvedHttpLoginSteps> {
  const validated = validateUserHttpLoginSteps(value);
  return validated.ok
    ? resolvePlan({ ...validated.value, credentialOrigins: [] }, connection)
    : validated;
}

function resolvePlan(
  file: Pick<
    HttpLoginSteps,
    "credentialOrigins" | "passwordOnly" | "loginSteps"
  >,
  connection: HttpLoginStepsConnection,
): HttpLoginStepsResult<ResolvedHttpLoginSteps> {
  const { issues, report } = collector();
  const connectionOrigin: unknown = connection?.connectionOrigin;
  if (!isConnectionOrigin(connectionOrigin)) {
    report("invalid-connection-origin", "connectionOrigin");
    return { ok: false, issues };
  }
  if (
    connectionOrigin.startsWith("http:") &&
    connectionOrigin !== connection.configuredHttpOrigin
  ) {
    report("insecure-connection-origin", "connectionOrigin");
    return { ok: false, issues };
  }

  const steps: ResolvedHttpLoginStep[] = [];
  let submits: ResolvedHttpLoginStep | undefined;
  file.loginSteps.forEach((step, index) => {
    const scope: ScopedStep | undefined =
      step.kind === "submit" ? undefined : step;
    const resolved: ResolvedHttpLoginStep = {
      index,
      kind: step.kind,
      origin: scope ? (scope.origin ?? connectionOrigin) : "",
      paths: [...(scope?.paths ?? [])],
      pathPrefixes: [...(scope?.pathPrefixes ?? [])],
      frame: scope?.frame ?? null,
      waitFor: step.waitFor ?? null,
      selectors: "selectors" in step ? { ...step.selectors } : {},
    };
    if (step.kind === "submit") {
      // Validation guarantees a credential step directly before.
      const target = submits as ResolvedHttpLoginStep;
      resolved.origin = target.origin;
      resolved.paths = [...target.paths];
      resolved.pathPrefixes = [...target.pathPrefixes];
      resolved.frame = target.frame;
      resolved.submission = step.submission;
      resolved.submits = target.kind as HttpLoginSubmitStage;
    } else if (step.kind !== "click") submits = resolved;
    steps.push(resolved);
  });
  checkSequence(steps, file.passwordOnly, report);
  if (issues.length) return { ok: false, issues };

  const origins = new Set(steps.map((step) => step.origin));
  return {
    ok: true,
    value: {
      passwordOnly: file.passwordOnly,
      connectionOrigin,
      credentialOrigins: [connectionOrigin, ...file.credentialOrigins].filter(
        (origin, index, all) =>
          origins.has(origin) && all.indexOf(origin) === index,
      ),
      crossOrigin: steps.some((step) => step.origin !== connectionOrigin),
      steps,
    },
  };
}
