import { totpApi } from "../../hooks/totp/useTOTP";
import type { TotpAlgorithm } from "../../types/totp";
import { CredentialFailure } from "./credentialFailure";

/** A code is handed out for copying or typing only while this much of its time
 * step is left: enough to paste it, or to finish typing it, before the server
 * moves on. A panel that merely displays a countdown passes 0 instead. */
export const TOTP_MIN_REMAINING_MS = 3000;

export interface TotpCodeParameters {
  secret: string;
  /** `sha1`, `sha256` or `sha512`, in either case. */
  algorithm: string;
  digits: number;
  period: number;
}

export interface GeneratedTotpCode {
  code: string;
  /** Unix milliseconds bounding the code's time step. */
  starts: number;
  expires: number;
  /** Throws once the step is over, or when the clock is before its start. */
  assertCurrent: () => void;
}

/** The time step containing `now`, for a period in seconds. */
export function totpWindow(period: number, now: number) {
  const step = period * 1000;
  const starts = Math.floor(now / step) * step;
  return { starts, expires: starts + step };
}

/** Why a code that ends at `expires` may not be handed out now, or null. */
export function totpRemainingFailure(
  expires: number,
  now: number,
  minimumRemainingMs = TOTP_MIN_REMAINING_MS,
): "code-expired" | "code-window-closing" | null {
  if (now >= expires) return "code-expired";
  return expires - now < minimumRemainingMs ? "code-window-closing" : null;
}

function assertParameters(config: TotpCodeParameters): TotpAlgorithm {
  const algorithm =
    typeof config.algorithm === "string" ? config.algorithm.toUpperCase() : "";
  if (
    typeof config.secret !== "string" ||
    !config.secret ||
    config.secret.length > 4096 ||
    !["SHA1", "SHA256", "SHA512"].includes(algorithm) ||
    ![6, 7, 8].includes(config.digits) ||
    !Number.isInteger(config.period) ||
    config.period < 1 ||
    config.period > 3600
  )
    throw new CredentialFailure("authenticator-invalid");
  return algorithm as TotpAlgorithm;
}

/**
 * The only place a saved authenticator becomes a code. The secret goes to
 * `totp_compute_code` and nowhere else; a failure names its cause and never
 * carries the secret, the code or the generator's own text.
 */
export async function generateTotpCode(
  config: TotpCodeParameters,
  options: {
    minimumRemainingMs?: number;
    now?: () => number;
    computeCode?: typeof totpApi.computeCode;
  } = {},
): Promise<GeneratedTotpCode> {
  const now = options.now ?? Date.now;
  const minimum = options.minimumRemainingMs ?? TOTP_MIN_REMAINING_MS;
  const algorithm = assertParameters(config);
  const { starts, expires } = totpWindow(config.period, now());
  // Refuse before asking the generator, so a doomed code is never computed.
  const early = totpRemainingFailure(expires, now(), minimum);
  if (early) throw new CredentialFailure(early);
  let code: unknown;
  try {
    code = await (options.computeCode ?? totpApi.computeCode)(
      config.secret,
      algorithm,
      config.digits,
      config.period,
    );
  } catch {
    throw new CredentialFailure("code-not-generated");
  }
  if (
    typeof code !== "string" ||
    !new RegExp(`^\\d{${config.digits}}$`).test(code)
  )
    throw new CredentialFailure("code-not-generated");
  // Generating is asynchronous: the step may have ended, or the clock moved.
  if (now() < starts) throw new CredentialFailure("code-expired");
  const late = totpRemainingFailure(expires, now(), minimum);
  if (late) throw new CredentialFailure(late);
  return {
    code,
    starts,
    expires,
    assertCurrent: () => {
      if (now() < starts || now() >= expires)
        throw new CredentialFailure("code-expired");
    },
  };
}
