# Embedded browser proxy routing

The embedded HTTP(S) browser uses a native, session-owned loopback proxy for
its initial page and supported same-origin requests. This is an incremental
hardening boundary, **not a guarantee that every browser-engine network request
is mediated**. It does not change SSH, RDP, or other integration transports.

## Supported route

- Each browser session receives its own unpredictable
  `http://p<random>.localhost:<port>` origin. Bare `localhost` or `127.0.0.1` is
  not an interchangeable access URL.
- Same-origin HTML, scripts, styles, form submissions, fetch/XHR, and supported
  dynamically constructed URLs are routed through that session. A document
  client maps URLs for compatibility; it is not itself a security sandbox.
- Same-origin WebSockets use a real HTTP/1.1 upgrade and native bidirectional
  relay. They reuse the HTTP session's client, configured upstream HTTP(S)
  proxy, authentication, cookie jar, and accepted certificate identity. There
  is no alternate direct connection after an upgrade or proxy failure.
- A WebSocket requires the protected origin and current document identity.
  Redirected or malformed handshakes are refused. Source navigation, session
  stop/restart, and listener termination revoke relays. Limits are 16 sockets
  per session, 15-second handshake/upgrade deadlines, 60 seconds without traffic
  in either direction, and a 30-minute maximum relay lifetime. Frames pass
  through fixed-size buffers; compression extensions are not negotiated.

The parent browser validates and selects the primary document. Loading an
embedded child frame does not revoke its parent's sockets; child-frame
WebSockets are not supported in this slice. A new primary document's early
socket waits up to five seconds for selection, without contacting the upstream
before approval. Stale document identities cannot regain access.

Retargeting an existing `Request` object may require buffering its body for
Chromium's HTTP/1.1 transport. This compatibility buffer is capped at 16 MiB and
cancelled on abort or page teardown; exceeding it fails without truncation or a
direct retry. Ordinary `fetch(url, init)` and XHR bodies retain their native
path. Existing server-side request limits still apply independently.

The configured source login, secret headers, query additions, cookies, and
certificate pin are not reusable permission for another origin. A source
WebSocket cannot redirect those values to another server. HTTPS inspection and
the connection itself remain subject to the existing trust workflow.

## Foreign origins and unsupported traffic

Third-party origins are currently **blocked, not transparently proxied**.
This includes a CDN or API that an otherwise trusted page references. A trusted
redirect destination is not automatically an approved subresource origin or
TLS identity. Supporting such origins requires a separate origin mapping and
trust decision; arbitrary URLs are not sent through a generic native fetch
endpoint under the authenticated page's origin.

Mandatory response CSP restricts resources, connections, frames, and forms to
the session origin and its local WebSocket endpoint. It applies to assets and
error responses as well as successful pages, regardless of website script
settings. DNS prefetch is disabled on these responses. This may make pages
depending on foreign services report blocked resources or remain incomplete.

Workers, SharedWorkers, service-worker registration, WebRTC, and WebTransport
are not supported by this embedded routing slice. Worker creation is blocked
by response policy, and the document client refuses unsupported constructors.
JavaScript wrappers are compatibility controls that a page can tamper with;
they do not prove containment of WebRTC, every alternate realm, speculative
engine traffic, or other browser-internal connections. No process-wide egress
firewall or isolated browser-network context is claimed.

On Windows, native frame navigation permits only registered live proxy origins
and blank/srcdoc frames. A separate pre-request **document-only** filter refuses
unapproved document requests with a local 403 response; it also permits the
compiled application origin needed to bootstrap the main shell. Frame checks
still refuse embedding that application origin. Popups and external navigation
are denied. Frame-navigation cancellation alone is insufficient: a browser can
start a request before delivering that event.

This shared WebView filter does not cover general subresources or WebSockets,
and speculative TCP connections remain possible. It is not an all-network
firewall. Other platforms report the native guard as unsupported rather than
claiming equivalent enforcement. Mandatory CSP and the document client do not
replace that missing platform guarantee.

Opening a page explicitly in an external browser is a separate route, using
that browser's own networking and trust configuration. It is not a proxy
fallback and is not covered by this embedded-browser policy.

## Availability and recovery

Windows proxy creation waits for successful installation of the frame guard.
If it is unavailable, proxy startup fails with restart guidance instead of
exposing an unguarded frame. Restart the application after native guard changes;
a frontend hot reload cannot install a new native callback. Closing a proxy
revokes its exact origin, so a stale manager entry cannot provide a usable
unauthenticated loopback replacement URL.

## Developer checks and limits

From `src-tauri`, using an agent-owned target directory:

```text
node ../scripts/native-build-env.mjs cargo test -p sorng-protocols http:: --lib --locked --target-dir ../.artifacts/cargo-synology
node ../scripts/native-build-env.mjs cargo test -p sorng-protocols webview_origins --lib --locked --target-dir ../.artifacts/cargo-synology
node ../scripts/native-build-env.mjs cargo test -p sorng-commands-core explicit_proxy_client_ignores_ambient_environment_in_isolated_child --locked --target-dir ../.artifacts/cargo-synology
node ../scripts/native-build-env.mjs cargo clippy -p sorng-protocols --all-targets --locked --target-dir ../.artifacts/cargo-synology -- -D warnings
```

`http_network_tests.rs` exercises synthetic loopback upgrades, source credential
and query handling, HTTPS pinning through HTTP CONNECT, handshake refusals,
revocation, and response-policy coverage. `http_websocket.rs` includes raw-query
and one-way-traffic idle regressions. Existing HTTP response, TLS, and reviewed
redirect fixtures remain relevant. These tests do not contact user sites,
install trusted roots, prove compatibility with every website, or establish
zero browser-engine egress. Native app compilation and actual platform guard
acceptance are separate gates.

From the repository root, `node scripts/test-web-network-browser.mjs` exercises
the compatibility bridge in installed headless Edge using synthetic endpoints.
This is not a native-proxy or whole-engine containment test. The ambient-proxy
regression above changes proxy environment variables only in an isolated test
child process, never in the application or the shared test process.
