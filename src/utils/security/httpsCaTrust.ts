import type { InheritableTrustPolicy, TrustPolicy } from "../auth/trustStore";

export type HttpsCaTrustMode = "system" | "review";

/** Missing legacy preference gets browser-style CA trust; malformed data cannot relax review. */
export function normalizeHttpsCaTrustMode(value: unknown): HttpsCaTrustMode {
  return value === undefined || value === "system" ? "system" : "review";
}

export function validateHttpsCaTrustMode(value: unknown): HttpsCaTrustMode {
  if (value !== "system" && value !== "review")
    throw new Error("Choose a valid HTTPS certificate approval preference.");
  return value;
}

/** A new origin cannot inherit an unsafe bypass, but explicit restrictive policies survive. */
export function redirectHttpsTrustPolicy(
  policy?: InheritableTrustPolicy,
  legacyPolicy?: TrustPolicy,
): InheritableTrustPolicy {
  const selected = policy && policy !== "inherit" ? policy : legacyPolicy;
  return selected === "strict" || selected === "always-ask"
    ? selected
    : "inherit";
}

/** A volatile redirect may inherit stricter app policies, but never a CA/pin bypass. */
export function constrainRedirectHttpsPolicy(
  policy: TrustPolicy,
  redirected: boolean,
  originalPolicy?: InheritableTrustPolicy,
  originalLegacyPolicy?: TrustPolicy,
): TrustPolicy {
  if (redirected) {
    const original = redirectHttpsTrustPolicy(
      originalPolicy,
      originalLegacyPolicy,
    );
    if (policy === "strict" || original === "strict") return "strict";
    if (original === "always-ask") return "always-ask";
  }
  return redirected && policy === "always-trust" ? "always-ask" : policy;
}
