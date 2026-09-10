import {
  DEFAULT_PASSWORD_POLICY,
  type PasswordPolicy,
} from "../../types/security/passwordPolicy";
import { getInvoke } from "../tauri/invoke";

export type PasswordPurpose =
  "database" | "application" | "export" | "generator";

export function normalizePasswordPolicy(value: unknown): PasswordPolicy {
  if (value === undefined) return { ...DEFAULT_PASSWORD_POLICY };
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Password policy is invalid. Review Security settings.");
  const policy = value as Record<string, unknown>;
  if (
    Object.keys(policy).some(
      (key) =>
        !Object.prototype.hasOwnProperty.call(DEFAULT_PASSWORD_POLICY, key),
    ) ||
    policy.version !== 1 ||
    !Number.isInteger(policy.minLength) ||
    (policy.minLength as number) < 4 ||
    (policy.minLength as number) > 128 ||
    [
      "enabled",
      "requireUppercase",
      "requireLowercase",
      "requireDigit",
      "requireSymbol",
    ].some((key) => typeof policy[key] !== "boolean")
  )
    throw new Error("Password policy is invalid. Review Security settings.");
  return { ...policy } as unknown as PasswordPolicy;
}

export function passwordPolicyError(
  password: string,
  value: unknown,
  purpose: PasswordPurpose,
): string | null {
  const policy = normalizePasswordPolicy(value);
  const minimum = Math.max(
    purpose === "database" ? 4 : purpose === "export" ? 0 : 8,
    policy.enabled ? policy.minLength : 0,
  );
  if ([...password].length < minimum)
    return `Use at least ${minimum} characters.`;
  if (!policy.enabled) return null;
  for (const [required, pattern, label] of [
    [policy.requireUppercase, /[A-Z]/, "an uppercase letter (A–Z)"],
    [policy.requireLowercase, /[a-z]/, "a lowercase letter (a–z)"],
    [policy.requireDigit, /[0-9]/, "a digit (0–9)"],
    [policy.requireSymbol, /[!-/:-@[-`{-~]/, "an ASCII punctuation symbol"],
  ] as const)
    if (required && !pattern.test(password)) return `Include ${label}.`;
  return null;
}

/** Native re-reads persisted settings; no policy supplied by the caller. This
 * does not make a later opaque legacy WebCrypto save cryptographic proof. */
export async function validateNewPassword(
  password: string,
  purpose: PasswordPurpose,
): Promise<void> {
  const invoke = await getInvoke();
  if (invoke) {
    await invoke("encryption_validate_new_password", { password, purpose });
    return;
  }
  const { SettingsManager } = await import("../settings/settingsManager");
  const settings = await SettingsManager.getInstance().loadSettings();
  const error = passwordPolicyError(password, settings.passwordPolicy, purpose);
  if (error) throw new Error(error);
}

/** Unbiased WebCrypto sampling, with at least one character per required class. */
export function generatePolicyPassword(value: unknown): string {
  const policy = normalizePasswordPolicy(value);
  const classes = [
    "ABCDEFGHJKLMNPQRSTUVWXYZ",
    "abcdefghijkmnopqrstuvwxyz",
    "23456789",
    "!#$%&()*+,-./:;<=>?@[]^_{|}~",
  ];
  const pick = (characters: string) => {
    const byte = new Uint8Array(1);
    do {
      crypto.getRandomValues(byte);
    } while (byte[0] >= 256 - (256 % characters.length));
    return characters[byte[0] % characters.length];
  };
  const characters = classes.join("");
  const result = classes.map(pick);
  while (result.length < Math.max(20, policy.enabled ? policy.minLength : 0))
    result.push(pick(characters));
  for (let i = result.length - 1; i > 0; i--) {
    const indexes = Array.from({ length: i + 1 }, (_, index) =>
      String.fromCharCode(index),
    );
    const j = pick(indexes.join("")).charCodeAt(0);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.join("");
}
