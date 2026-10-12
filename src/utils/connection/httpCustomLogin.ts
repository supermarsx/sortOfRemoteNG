import type { HttpAutoLoginSelectors } from "../../types/connection/connection";
import type { HttpCustomLoginOptions } from "../../types/connection/httpCustomLogin";
import type {
  HttpLoginStep,
  HttpLoginStepsResult,
  HttpLoginUserSteps,
} from "../../types/connection/httpLoginSteps";
import { validateUserHttpLoginSteps } from "./httpLoginSteps";

const OPTION_KEYS = ["frame", "passwordOnly", "preStepSelector", "submission"];

/** Stand-ins for the selectors, so the options can be checked on their own. */
const PROBE_SELECTORS: HttpAutoLoginSelectors = {
  usernameSelector: "#username",
  passwordSelector: "#password",
  submitSelector: "#submit",
};

/** The selectors a custom login cannot run without, given its options. */
export function requiredHttpCustomLoginSelectors(
  options: HttpCustomLoginOptions | undefined,
): (keyof HttpAutoLoginSelectors)[] {
  return [
    ...(options?.passwordOnly ? [] : (["usernameSelector"] as const)),
    "passwordSelector",
    ...(options?.submission === "enter" ? [] : (["submitSelector"] as const)),
  ];
}

/**
 * The Custom application's selectors and options as login steps in the
 * catalog's format. `validateUserHttpLoginSteps` is the only judge of the
 * result: no step can name an origin, so these steps run on the connection's
 * own origin and nowhere else.
 */
export function buildHttpCustomLoginSteps(
  selectors: HttpAutoLoginSelectors | undefined,
  options: HttpCustomLoginOptions,
): HttpLoginStepsResult<HttpLoginUserSteps> {
  const scope = options.frame === undefined ? {} : { frame: options.frame };
  const text = (value: string | undefined) => value?.trim();
  const username = text(selectors?.usernameSelector);
  const password = text(selectors?.passwordSelector);
  const loginSteps = [
    ...(options.preStepSelector === undefined
      ? []
      : [
          {
            kind: "click",
            ...scope,
            selectors: { control: text(options.preStepSelector) },
          },
        ]),
    options.passwordOnly
      ? { kind: "password", ...scope, selectors: { password } }
      : { kind: "form", ...scope, selectors: { username, password } },
    options.submission === "enter"
      ? { kind: "submit", submission: "enter" }
      : {
          kind: "submit",
          submission: options.submission ?? "click",
          selectors: { control: text(selectors?.submitSelector) },
        },
  ] as HttpLoginStep[];
  return validateUserHttpLoginSteps({
    passwordOnly: options.passwordOnly === true,
    loginSteps,
  });
}

/**
 * Reads `httpApplication.customLogin`. `undefined`: no option is set (the
 * defaults are not stored). `null`: present but unusable, and the caller fails
 * closed. Frame and selector bounds are the login steps format's own.
 */
export function normalizeHttpCustomLoginOptions(
  value: unknown,
): HttpCustomLoginOptions | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return null;
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !OPTION_KEYS.includes(key))) return null;
  const options: HttpCustomLoginOptions = {};
  if (raw.frame !== undefined) {
    if (typeof raw.frame !== "string") return null;
    options.frame = raw.frame;
  }
  if (raw.passwordOnly !== undefined) {
    if (typeof raw.passwordOnly !== "boolean") return null;
    if (raw.passwordOnly) options.passwordOnly = true;
  }
  if (raw.preStepSelector !== undefined) {
    if (typeof raw.preStepSelector !== "string" || !raw.preStepSelector.trim())
      return null;
    options.preStepSelector = raw.preStepSelector.trim();
  }
  if (raw.submission !== undefined) {
    if (
      raw.submission !== "click" &&
      raw.submission !== "enter" &&
      raw.submission !== "spa"
    )
      return null;
    if (raw.submission !== "click") options.submission = raw.submission;
  }
  if (Object.keys(options).length === 0) return undefined;
  return buildHttpCustomLoginSteps(PROBE_SELECTORS, options).ok
    ? options
    : null;
}
