export interface PasswordGeneratorOptions {
  length: number;
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

export const DEFAULT_PASSWORD_OPTIONS: Readonly<PasswordGeneratorOptions> =
  Object.freeze({
    length: 20,
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: true,
  });

const CHARACTER_GROUPS = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.?/~",
} as const;
const GROUP_NAMES = Object.keys(CHARACTER_GROUPS) as Array<
  keyof typeof CHARACTER_GROUPS
>;
const AMBIGUOUS_CHARACTERS = /[Il1O0o|]/g;

export function validatePasswordOptions(
  options: PasswordGeneratorOptions,
): string | null {
  if (
    !Number.isInteger(options.length) ||
    options.length < MIN_PASSWORD_LENGTH ||
    options.length > MAX_PASSWORD_LENGTH
  ) {
    return `Choose a whole-number length from ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH}.`;
  }
  if (
    [...GROUP_NAMES, "excludeAmbiguous" as const].some(
      (key) => typeof options[key] !== "boolean",
    )
  ) {
    return "Character options must be enabled or disabled.";
  }
  if (!GROUP_NAMES.some((key) => options[key])) {
    return "Select at least one character type.";
  }
  return null;
}

/** Generates locally using Web Crypto; never falls back to Math.random. */
export function generatePassword(
  options: PasswordGeneratorOptions = DEFAULT_PASSWORD_OPTIONS,
): string {
  const error = validatePasswordOptions(options);
  if (error) throw new Error(error);
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error(
      "Secure random generation is unavailable in this environment.",
    );
  }

  const groups = GROUP_NAMES.filter((key) => options[key]).map((key) =>
    options.excludeAmbiguous
      ? CHARACTER_GROUPS[key].replace(AMBIGUOUS_CHARACTERS, "")
      : CHARACTER_GROUPS[key],
  );
  const alphabet = groups.join("");
  const sample = new Uint32Array(1);
  // Discard the incomplete remainder to avoid modulo bias.
  const limit = Math.floor(0x100000000 / alphabet.length) * alphabet.length;
  const randomCharacter = () => {
    do {
      globalThis.crypto.getRandomValues(sample);
    } while (sample[0] >= limit);
    return alphabet[sample[0] % alphabet.length];
  };

  // Rejection of complete candidates makes every allowed password equally
  // likely while guaranteeing that every selected character type is present.
  let password: string;
  do {
    password = Array.from({ length: options.length }, randomCharacter).join("");
  } while (
    !groups.every((group) => [...password].some((char) => group.includes(char)))
  );
  sample.fill(0);
  return password;
}
