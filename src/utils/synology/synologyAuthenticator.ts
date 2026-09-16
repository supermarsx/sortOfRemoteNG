import type { Connection } from "../../types/connection/connection";
import type { TOTPConfig } from "../../types/settings/settings";
import type { TotpAlgorithm } from "../../types/totp";
import { isValidSynologyOtpAuthenticatorId } from "../../types/protocols/synology";
import { totpApi } from "../../hooks/totp/useTOTP";

/** Shown in the code dialog when the saved authenticator produced no usable code. */
export const SYNOLOGY_AUTOMATIC_CODE_UNAVAILABLE_MESSAGE =
  "The saved authenticator couldn't produce a code. Enter the code from your authenticator app.";
/** Shown in the code dialog when DSM refused the one generated code. */
export const SYNOLOGY_AUTOMATIC_CODE_REJECTED_MESSAGE =
  "DSM rejected the code generated from the saved authenticator. Check the authenticator secret and this computer's clock, or enter a code.";

export type SynologyAuthenticatorUnavailableReason =
  "missing" | "duplicate" | "no-secret" | "unsupported";

export const SYNOLOGY_AUTHENTICATOR_UNAVAILABLE_MESSAGES: Record<
  SynologyAuthenticatorUnavailableReason,
  string
> = {
  missing:
    "The selected authenticator is no longer on this connection. Choose or add an authenticator.",
  duplicate:
    "More than one authenticator on this connection has the selected id. Choose the authenticator again.",
  "no-secret":
    "The selected authenticator has no secret, for example after a database export. Add the authenticator secret again.",
  unsupported:
    "The selected authenticator's settings can't generate DSM codes. Use 6 or 8 digits, a 15–120 second period and SHA-1, SHA-256 or SHA-512.",
};

export const SYNOLOGY_TOTP_SECRET_MAX_LENGTH = 4096;
export const SYNOLOGY_TOTP_PERIOD_RANGE = { min: 15, max: 120 } as const;

export type SynologyLocalAuthenticator =
  | { kind: "none" }
  | { kind: "ready"; config: TOTPConfig & { id: string } }
  | { kind: "unavailable"; reason: SynologyAuthenticatorUnavailableReason };

/**
 * The connection-local authenticator referenced by
 * `synologySettings.otpAuthenticatorId`. Vault credentials never use a local
 * reference; they answer challenges with `credentialSource.totpId`.
 */
export function resolveLocalSynologyAuthenticator(
  connection: Pick<
    Partial<Connection>,
    "credentialSource" | "synologySettings" | "totpConfigs"
  >,
): SynologyLocalAuthenticator {
  if (connection.credentialSource?.kind === "vault") return { kind: "none" };
  const id = connection.synologySettings?.otpAuthenticatorId;
  if (id === undefined) return { kind: "none" };
  if (!isValidSynologyOtpAuthenticatorId(id))
    return { kind: "unavailable", reason: "missing" };
  const matches = (
    Array.isArray(connection.totpConfigs) ? connection.totpConfigs : []
  ).filter((entry) => entry?.id === id);
  if (!matches.length) return { kind: "unavailable", reason: "missing" };
  if (matches.length > 1) return { kind: "unavailable", reason: "duplicate" };
  const config = matches[0];
  if (typeof config.secret !== "string" || !config.secret.trim())
    return { kind: "unavailable", reason: "no-secret" };
  if (
    config.secret.length > SYNOLOGY_TOTP_SECRET_MAX_LENGTH ||
    (config.digits !== 6 && config.digits !== 8) ||
    !Number.isSafeInteger(config.period) ||
    config.period < SYNOLOGY_TOTP_PERIOD_RANGE.min ||
    config.period > SYNOLOGY_TOTP_PERIOD_RANGE.max ||
    !["sha1", "sha256", "sha512"].includes(config.algorithm)
  )
    return { kind: "unavailable", reason: "unsupported" };
  return { kind: "ready", config: config as TOTPConfig & { id: string } };
}

export interface SynologyTotpClock {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface SynologyTotpWindowOptions {
  /** Seconds, from a resolved local authenticator or vault metadata. */
  period: number;
  /** In-memory identity of the DSM account; see `synologyOtpReplayKey`. */
  replayKey?: string;
}

/** A code needs this much of its time window left to reach DSM in time. */
export const SYNOLOGY_TOTP_MIN_REMAINING_MS = 3_500;
const WINDOW_SETTLE_MS = 250;
const WAIT_SLICE_MS = 500;
const unusable = "The saved authenticator couldn't produce a code.";
const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Last time a one-time code may have been accepted, per DSM account. Memory
 * only: never persisted, and it holds no code or secret.
 */
const submittedAt = new Map<string, number>();
const SUBMISSION_ENTRIES_MAX = 128;

export const synologyOtpReplayKey = (
  host: string,
  port: number,
  account: string,
) => JSON.stringify([host.toLowerCase(), port, account.toLowerCase()]);

/** Records a code DSM may have accepted, so no automatic code reuses its time step. */
export function recordSynologyOtpSubmission(
  replayKey: string,
  at: number = Date.now(),
) {
  submittedAt.delete(replayKey);
  submittedAt.set(replayKey, at);
  while (submittedAt.size > SUBMISSION_ENTRIES_MAX)
    submittedAt.delete(submittedAt.keys().next().value!);
}

/** Tests only. */
export function clearSynologyOtpSubmissions() {
  submittedAt.clear();
}

/**
 * Waits, bounded and cancel-aware, until the current window has at least
 * `SYNOLOGY_TOTP_MIN_REMAINING_MS` left and is not the step of the last
 * submitted code for this account. Returns when that window ends.
 */
export async function waitForSynologyTotpWindow(
  { period, replayKey }: SynologyTotpWindowOptions,
  assertAttempt: () => void,
  { now = Date.now, sleep = defaultSleep }: SynologyTotpClock = {},
): Promise<{ expires: number }> {
  if (
    !Number.isSafeInteger(period) ||
    period < SYNOLOGY_TOTP_PERIOD_RANGE.min ||
    period > SYNOLOGY_TOTP_PERIOD_RANGE.max
  )
    throw new Error(unusable);
  const periodMs = period * 1000;
  // At most one wait (≤ period + 250 ms): the next window is always fresh
  // unless the clock moved or another sign-in used it meanwhile.
  for (let pass = 0; pass < 2; pass++) {
    assertAttempt();
    const started = now();
    const step = Math.floor(started / periodMs);
    const expires = (step + 1) * periodMs;
    const last = replayKey ? submittedAt.get(replayKey) : undefined;
    const reused = last !== undefined && Math.floor(last / periodMs) === step;
    if (expires - started >= SYNOLOGY_TOTP_MIN_REMAINING_MS && !reused)
      return { expires };
    if (pass) break;
    const until = expires + WINDOW_SETTLE_MS;
    let slices = Math.ceil((until - started) / WAIT_SLICE_MS) + 4;
    for (let at = started; at < until && slices-- > 0; at = now()) {
      await sleep(Math.min(WAIT_SLICE_MS, until - at));
      assertAttempt();
    }
  }
  throw new Error(unusable);
}

export interface SynologyTotpParameters extends SynologyTotpWindowOptions {
  secret: string;
  algorithm: TOTPConfig["algorithm"];
  digits: 6 | 8;
}

/**
 * One code from a connection-local authenticator. The secret goes only to
 * `totp_compute_code`; errors never include the secret or the code.
 */
export async function generateSynologyTotpCode(
  { secret, algorithm, digits, period, replayKey }: SynologyTotpParameters,
  assertAttempt: () => void,
  clock: SynologyTotpClock & {
    computeCode?: typeof totpApi.computeCode;
  } = {},
): Promise<{ code: string; expires: number; assertCurrent: () => void }> {
  const now = clock.now ?? Date.now;
  const computeCode = clock.computeCode ?? totpApi.computeCode;
  assertAttempt();
  const { expires } = await waitForSynologyTotpWindow(
    { period, replayKey },
    assertAttempt,
    clock,
  );
  assertAttempt();
  let code: unknown;
  try {
    code = await computeCode(
      secret,
      algorithm.toUpperCase() as TotpAlgorithm,
      digits,
      period,
    );
  } catch {
    throw new Error(unusable);
  }
  assertAttempt();
  if (
    typeof code !== "string" ||
    !(digits === 8 ? /^\d{8}$/ : /^\d{6}$/).test(code) ||
    now() >= expires - 1000
  )
    throw new Error(unusable);
  return {
    code,
    expires,
    assertCurrent: () => {
      if (now() >= expires) throw new Error("This authenticator code expired.");
    },
  };
}
