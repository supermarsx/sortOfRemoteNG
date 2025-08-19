const DEFAULT_PBKDF2_ITERATIONS = 150000;

const envValue =
  typeof process !== "undefined" ? process.env.PBKDF2_ITERATIONS : undefined;

export const PBKDF2_ITERATIONS =
  envValue && !Number.isNaN(Number(envValue))
    ? Number(envValue)
    : DEFAULT_PBKDF2_ITERATIONS;

export { DEFAULT_PBKDF2_ITERATIONS };
