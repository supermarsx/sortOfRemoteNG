# Browser readiness evidence

This gate checks deterministic regressions for Google login, Cloudflare
login/challenge routing, Porkbun opening/login helpers, proxy isolation, injected
assets, browser identity and dark-mode readiness. It does **not** open a browser,
contact a live login endpoint, submit credentials, or certify that a service will
accept an embedded browser.

## Architecture and service limits

The current mediator rewrites upstream origins to isolated local aliases and
injects compatibility scripts into embedded documents. It is not a native
browser retaining the upstream HTTPS origins, even when it forwards the correct
WebView user agent. Reducing injected bytes and fixing script timing can improve
compatibility, but cannot establish that a provider accepts this architecture.

Google documents that sign-in can be blocked for browsers embedded in another
application or controlled by software automation. An identifier page rendering
successfully does not prove that Google will accept the password or complete
authentication. See [Google's supported-browser guidance](https://support.google.com/accounts/answer/7675428?hl=en).

Cloudflare requires Turnstile's API script at its canonical URL and warns that
proxying or caching it can break verification after updates. Fixing script
discovery in the current mediator does not remove that vendor limitation. See
[Cloudflare's client-side rendering guidance](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/).

A future design using an origin-preserving forward proxy and a top-level
renderer merits separate architectural work and acceptance testing. That is a
proposal, not an implemented capability or a promise that providers will accept
it. Browser identity spoofs are not evidence of acceptance. All application
requests, including redirects and secondary resources, must still traverse the
app proxy; neither current testing nor a future design permits direct fallback.

## Run the automated gate

From the repository root, with the repository's Node/npm versions and dependencies installed:

```powershell
npm run browser:readiness
npm run browser:readiness -- --report .artifacts/browser-readiness.json
npm run browser:readiness -- --native --report .artifacts/browser-readiness-native.json
node --test tests/tooling/browserReadiness.node-test.mjs
```

The fixed suite list is exported as `SUITES` in `scripts/browser-readiness.mjs`.
It includes `autologinAsset.test.ts`, `autologinScopedAsset.test.ts` and
`autologinClientLifecycle.test.ts`, so changes to staged asset assembly,
selected-adapter dispatch and lifecycle remain part of the gate. The
runner verifies a JSON receipt for every required file and requires at least one
executed, passing test in each. A missing dependency/file/receipt, skipped test,
empty selection, failed assertion or unsuccessful child exit cannot pass.

`--native` executes four scoped commands from the repository root, each with
its own status, counts and duration:

```powershell
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib cloudflare_challenge --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib google_tests --locked -- --skip live_accounts_navigation_distinguishes_malformed_metadata_from_native_identity_and_cookies
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib autologin_asset --locked
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib dark_mode::tests --locked
```

The native build wrapper sets up platform build helpers; there are no added
feature or target overrides. Existing Cargo environment/workspace configuration
still apply. These cover Cloudflare/Porkbun challenge transport/CSP, Google
identity/cookie/lifecycle fixtures, selected auto-login asset assembly and the
first-paint dark-mode CSS/readiness contract.
They do not run the whole workspace. The ignored live Google probe is explicitly
excluded with `--skip` and separately reported `not-run`. Cargo's filtered-out
tests are outside the declared scope; zero executed tests, failed tests or
ignored tests remaining within a selection fail that suite. Ignored counts are
reported independently and never counted as passed.

Exit `0` means only the requested automated layers passed; `1` means a requested
layer failed or did not run; `2` means a usage, runner or report-writing error.
The JSON separates `deterministic`, `native`, `embeddedLive` and `loginReadiness`.
The latter two always remain `not-run`. Native is `not-run` without `--native`.
Browser prerequisites are explicitly unprobed; an unavailable browser is never
treated as a successful browser check. There is no implemented live-test flag.

Reports contain fixed suite paths, statuses, counts, durations, timestamps and Node version.
Raw stdout/stderr, assertion titles, error stacks, account values, URLs with query
strings, cookies and tokens are not copied into the report or runner output.
The raw Vitest receipt is temporary and removed after parsing. `--report` replaces
the chosen report file; use an artifact path. To debug a failed fixture, run its
listed suite separately and inspect diagnostics locally before sharing them.

## Acceptance matrix

| Layer                      | Executable evidence                                                                                                                                       | What it proves                                                                                                                  | What remains unproved                                                                                          |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Deterministic              | Default runner                                                                                                                                            | Reviewed staged forms, injection/lifecycle, route rejection, identity options and paint recovery under mocks/jsdom              | Real parser/network timing, WebView behavior, vendor acceptance                                                |
| Native fixtures            | Runner with `--native`                                                                                                                                    | Actual Rust mediator against synthetic TLS/proxy peers; isolated cookies, exact origins, CSP, redirects and document revocation | Live challenge solve, Google account login, production transport                                               |
| Installed browser fixtures | `node scripts/test-web-network-browser.mjs`; `node --test tests/tooling/webBrowserFrame.browser-test.mjs tests/tooling/webSpaNavigation.browser-test.mjs` | Real Edge/Chromium semantics against local synthetic pages                                                                      | Tauri injection/native mediator and the three live services; these are separate commands, not run by this gate |
| Embedded live              | Manual procedure below                                                                                                                                    | Only the stages actually observed in the built Tauri/WebView app                                                                | Every unobserved stage remains not-run; blocked verification is not success                                    |

The installed-browser harnesses require a browser executable and can skip when
it is absent: a skipped browser test is **not-run**, even if Node exits zero.
The app runner at `e2e/wdio.conf.ts` requires a verified isolated binary via
`TAURI_BINARY_PATH` (built using `npm run e2e:build`). Its existing HTTP Viewer
spec mainly checks visible UI; it is not a Google/Cloudflare/Porkbun login gate.
No dedicated desktop login specs for those three were found in this audit.

The Synology CDP harness is a useful design reference. Its updated mirror passes
19 static production-shape checks across five native source files, and the
script passes `node --check`. It models the mode-scoped Synology asset and current
network/readiness bootstrap; the complete legacy bundle has a separate guard.
The browser harness itself has not been run for this validation, so these static
checks are not browser or login evidence. No live-session test or automated
browser prerequisite check is implemented in this runner.

## Actual WebView acceptance

### Repeatable anonymous live probe (Windows)

`npm run browser:live` builds and runs a disposable **real WebView2** host with
the production proxy startup, response rewriting, cookie handling and Windows
network guard. It opens Google Analytics's Google sign-in route, Cloudflare
Dashboard and Porkbun, once normally and once with the proxy's dark bootstrap.
Use `-- --site porkbun --dark` for one case. Each case observes for 45 seconds.
Use `-- --report .artifacts/browser-live-check.json` to preserve a separate run.

This is not jsdom, a recorded HTTP response or an unrelated browser. It is also
not the entire React/Tauri application shell: the small parent reproduces its
sandbox and validated document-activation handshake. The dark bootstrap's local
CSS fallback is tested, not the React-delivered DarkReader configuration.
There is no debugger port, fake User-Agent or WebDriver flag. Each invocation
uses an isolated temporary profile and closes its controller and proxy afterward.
It never opens the application's database or imports an existing browser profile.

The sanitized `.artifacts/browser-live.json` contains visible form counts,
challenge/refusal booleans, script/CSP error counts, activation counts, request
status counts and blocked origins. It contains no field values, cookies, query
strings or raw page/console text. Missing observations and unrendered forms fail
the command. **A rendered form is not a successful login:** identifier submission,
password, MFA, human challenges, authenticated state and reload remain untested
until exercised interactively with a test account. No dummy credentials are sent.
An ordinary Cargo test run skips this public-network probe unless `--live` is
explicitly supplied. Site refusals are test findings, not reasons to disable the
network guard or browser security.

#### Observed on 2026-10-01

The six-case matrix ran against the real public services with Windows WebView2
146.0.3856.84 and its native Edge 146 User-Agent, verified upstream TLS and the
default per-connection network policy. Every normal run removed its temporary
profile after closing the browser. Results are opening-stage evidence only:

| Site | Dark off | Dark bootstrap on | Remaining evidence gap |
| --- | --- | --- | --- |
| Google Analytics / Google sign-in | Email field visible, no observed script/CSP errors | Same; dark shield released | Identifier submission, password, MFA, authentication, reload |
| Porkbun | Username/password visible; Turnstile present | Same; dark shield released | Human verification and authenticated login; two resource/CSP blocks remain |
| Cloudflare Dashboard | 403 managed challenge, no login fields after 45 seconds | Same; dark shield released | Challenge completion and every login stage |

A focused Cloudflare rerun recorded `Worker` / `unsupported-network-context`
from the **production injected network layer**. This is an app-side compatibility
blocker even though no uncaught script/CSP error was reported. The source blocks
Worker/SharedWorker/WebTransport construction in `web_network_client.js`; a
future repair needs guarded worker execution and mediated worker requests, not
an unrestricted constructor or direct-network escape. Removing this blocker is
not proof that Cloudflare will accept a rewritten-origin proxy session.

Local receipts: `.artifacts/browser-live.json` (complete matrix) and
`.artifacts/browser-live-cloudflare-diagnostic.json` (categorized block).
The runner correctly exits nonzero for the unresolved Cloudflare cases. The
anonymous probe never asserts successful account login or challenge clearance.

### Full application and authenticated acceptance

Use a freshly built isolated app profile, a test account entered interactively,
and the intended saved application profile and proxy settings. Record build
revision, WebView version, platform, enabled options, stage outcomes and elapsed
times. Keep account values, credential fields, tokens/cookies, query strings and
unredacted screenshots/network traces out of shared artifacts. The runner does
not collect or import this manual evidence.

1. Open each saved profile through the app proxy: Google Accounts via its
   approved application route, Cloudflare Dashboard, and Porkbun
   `/account/login`. Require visible usable content, successful document
   activation and no uncaught shim/injection error. Porkbun opening is its own
   acceptance result; it does not require a successful login to pass that stage.
2. Observe email/username, then password. Check that only the intended stage
   receives credentials, fields remain usable through SPA transitions, and
   submit does not duplicate. Mark absent stages not-observed rather than passed.
3. If a challenge appears, require its API script/frame/resources to use the
   native proxy aliases. Check both parser-loaded and dynamically created script
   discovery; `script.src` may present the canonical Turnstile API URL while the
   native loading attribute remains local. Complete verification manually when
   the service permits it. Record a refusal or inability to complete as such;
   never bypass it or infer success from a challenge token's presence.
4. Require a real authenticated application view and a successful authenticated
   operation that reads harmless account state. A submitted form, HTTP 200,
   anonymous GET, hidden challenge or fixture success is insufficient.
5. Reload within the same app session and confirm authenticated state persists
   through the native cookie jar and proxy. Then close/reopen as a separate
   observation; do not assume persistence across a new proxy/session lifetime.

For each site retain separate results for opening, identifier, password,
challenge, authenticated state and reload. Distinguish failed, not-run and
not-observed. Fonts/Stripe policy blocks are separately recorded by origin and
resource type; they do not authorize wildcard permissions or disabled CSP.

## Timing and injected footprint comparison

Measure the same page/build/profile with optional dark mode, automation/recording
and compatibility settings off, then enable one at a time. Keep the mandatory
network guard, native proxy enforcement and CSP active in every comparison.
Do not change browser identity to claim a verification bypass. Compare multiple
runs, recording cold/warm conditions and only nonsecret timings/counts:

- Navigation to guard installation, `proxy_document_start`, native activation,
  first upstream script, first usable form, `proxy_dom_ready` and paint-ready.
- Injected script bytes/count, long tasks, uncaught exception counts, CSP
  violation origins/directives and whether requested resources reached the
  expected local alias. Assert zero unintended direct application requests.
- Parser-blocking, async/defer and dynamically inserted Turnstile scripts;
  Google identifier-to-password transitions; Porkbun's named blank iframe;
  refresh/close while activation or challenge resources are pending.

Source-backed candidates, not additional proven live bugs: `http_response.rs`
installs networking, dark mode and automation before emitting
`proxy_document_start`; a synchronous exception can prevent that signal.
`useHTTPViewer.ts` invokes native activation only after a validated signal.
`http_network_client.rs::await_document` bounds that wait to five seconds;
challenge parser requests wait for that activation. Existing native fixtures
cover selection/newer-document/stop with a short delay, not a busy embedded
renderer exceeding the deadline. Measure this chain before changing ordering.
The early inserter intentionally precedes upstream executable content; verify
that property on actual returned HTML rather than assuming jsdom proves it.

An existing ignored native Google probe performs anonymous GETs and checks
request metadata/cookies. It uses a recorded browser identity and is neither a
real WebView run nor a post-identifier login test. To explicitly run that
public-network diagnostic separately from the root:

```powershell
node scripts/native-build-env.mjs cargo test --manifest-path src-tauri/Cargo.toml -p sorng-protocols --lib live_accounts_navigation_distinguishes_malformed_metadata_from_native_identity_and_cookies --locked -- --ignored
```

The filter intentionally omits `--exact`, which would require the full Rust
module path. This GET-only diagnostic cannot promote any live-login stage.
