# Native login modules

`../native_login_client.js` is the private coordinator. The production
`../native_login_profiles.rs` manifest embeds these fragments inside its closure:

- `challenge.js`: bounded document-readiness and Cloudflare verification hold.
- `drone_consent.js`: reviewed, action-only SCM consent.
- `otp.js`: OTP discovery, grant requests, native key receipts and cancellation.
- `tactical_focus.js`: pure pre-grant retry decision for Tactical RMM's modal.
- `providers.js`: reviewed staged provider login flows.
- `deferred_form.js`: separately authorized form preparation, fill and submit.
- `declarative.js`: recorded login-step execution.

These are lexical fragments, not page globals or user-supplied scripts. Native
owner, document, origin, consent, expiry and one-shot delivery checks still apply.
Only executable code is cached once per process. Configuration stays in V8 data
values; credentials and OTP digits never enter cached source strings.

The proxy and native OTP adapters include the same read-only validators from
`sorng-protocols/src/autologin/common/totp_guards.js`. The proxy automation source
is assembled by `web_automation_asset.rs`; never inject its template directly.

JavaScript fixtures use `tests/helpers/nativeLoginAsset.mjs`, which consumes the
production manifest. Pure retry tests need no browser; the native login/OTP and
declarative JSDOM suites exercise complete production bundles and grant ordering.
Rust source-assembly tests can run without CEF via `rustc --test` on
`native_login_profiles.rs` and `web_automation_asset.rs`.
