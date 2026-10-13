/**
 * Engine gates for declarative login steps (`types/connection/httpLoginSteps`).
 *
 * Steps data ships before the engines that run it. While a gate is `false` the
 * engine it names has not landed, and nothing may offer or start a steps-based
 * login there: the catalog stays exactly as it was and saved connections keep
 * their behaviour.
 *
 * Deliberately plain `boolean`s, not literal types, so both branches stay live
 * for the type checker and for tests. They have a module of their own because
 * tests replace this module as a whole.
 */

/**
 * The native engine: its declarative adapter and the credential authority for
 * steps. While `false`, a profile with a steps file offers what it offered
 * before and the editor shows no steps-based option. The catalog generator
 * (`scripts/generate-native-login-catalog.mjs`) then validates the steps
 * files and emits none: the registry is empty and the native catalog carries
 * no `declarativeLogin` and no `declarativeLoginSupported`.
 *
 * Switching on is two steps in one change: set this to `true`, then run the
 * generator once. Its `--check` fails until both generated files follow.
 */
export const DECLARATIVE_LOGIN_SUPPORTED: boolean = true;

/**
 * The legacy proxy engine, which runs same-origin steps only. While `false`,
 * `resolveHttpApplicationLogin` never hands that engine a steps-based login: it
 * would fall back to its generic form heuristic. Requires
 * `DECLARATIVE_LOGIN_SUPPORTED`.
 */
export const DECLARATIVE_LOGIN_LEGACY_SUPPORTED: boolean = false;
