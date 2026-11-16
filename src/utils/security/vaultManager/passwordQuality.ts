export type PasswordQualityLevel =
  "veryWeak" | "weak" | "fair" | "good" | "strong";

/** Rough entropy from the character classes used; repeated characters are
 * discounted. Computed on the fly from a generated value, never stored. */
export function estimatePasswordBits(password: string): number {
  if (!password) return 0;
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^A-Za-z0-9]/.test(password)) pool += 32;
  const unique = new Set(password).size;
  const effective = Math.min(password.length, unique * 2);
  return Math.round(effective * Math.log2(Math.max(pool, 2)));
}

export function passwordQuality(password: string): {
  bits: number;
  level: PasswordQualityLevel;
  /** 0..1 for the meter. */
  ratio: number;
} {
  const bits = estimatePasswordBits(password);
  const level: PasswordQualityLevel =
    bits < 28
      ? "veryWeak"
      : bits < 45
        ? "weak"
        : bits < 65
          ? "fair"
          : bits < 90
            ? "good"
            : "strong";
  return { bits, level, ratio: Math.min(1, bits / 128) };
}
