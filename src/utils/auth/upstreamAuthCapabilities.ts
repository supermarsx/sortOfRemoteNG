/**
 * Backend capability gates for `HttpApplicationLogin.upstreamAuthMode`.
 *
 * `UpstreamAuthMode` (`sorng-protocols/src/http.rs`) is a closed serde enum and
 * `start_basic_auth_proxy` takes its config as a typed command argument, so a
 * mode the backend cannot place is decided at the argument boundary rather than
 * inside the command. The Rust side now carries an `#[serde(other)] Unknown`
 * fallback that resolves to **no** `Authorization` header, so a version skew
 * degrades instead of refusing to connect — but a degraded connection is still
 * a broken one, and these gates exist so the frontend never ships a mode ahead
 * of the Rust side in the first place.
 *
 * Deliberately a plain `boolean`, not a literal type: both branches stay live
 * for the type checker and for tests.
 */

/**
 * `true` since t96-e2: `UpstreamAuthMode::YealinkServlet` exists in `http.rs`,
 * and the proxy signs the phone in natively before the web view loads. Both
 * halves land together — flipping this without the Rust variant would make a
 * saved `{id: "voip-phone", loginMode: "form"}` connection degrade to an
 * unauthenticated session on an older backend.
 */
export const YEALINK_SERVLET_UPSTREAM_SUPPORTED: boolean = true;
