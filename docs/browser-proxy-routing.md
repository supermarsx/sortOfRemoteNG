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
- Both `ws://` and `wss://` URLs for the current upstream origin use this route;
  `wss://` retains verified upstream TLS even though the protected loopback
  browser connection uses `ws://`. Negotiated subprotocols, binary messages,
  fragmented messages, ping/pong, and close frames pass through unchanged.
  Arbitrary foreign-origin sockets are not supported: a trusted redirect or
  QuickConnect discovery/probe grant is not a WebSocket grant. After an approved
  navigation establishes a new session origin, its same-origin sockets use
  that new session's independent route.
- Handshake attempts reaching the WebSocket handler appear in the bounded
  proxy request log as **WebSocket handshake**, with status and a fixed error
  category only. Socket paths, query strings, headers, subprotocol values and
  message contents are not logged. Upstream 4xx/5xx rejections keep their HTTP
  status, but no upstream response body, cookies, login challenge or redirect
  headers are exposed. Malformed upstream upgrades and transport failures remain 502.

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

## Synology default redirect destinations

For Synology DSM website profiles and recognized QuickConnect HTTP(S)
connections, **Use Synology default redirect destinations** is enabled by
default. Find it in the connection editor's **HTTP(S) → Advanced → Internal
proxy controls**. Clear the checkbox and save to opt out.

The fixed destination list is:

- `http://<original NAS alias>.quickconnect.to` on port 80, when the original
  address identifies a NAS alias;
- `https://<original NAS alias>.quickconnect.to` on port 443 for that same alias;
- `https://global.quickconnect.to` on port 443;
- `https://www.quickconnect.to` on port 443.

The alias comes only from the original connection. For example,
`https://nas-example.fr3.quickconnect.to` identifies
both `http://nas-example.quickconnect.to` and
`https://nas-example.quickconnect.to`. A single alias label or an alias followed
by one region label (two lowercase letters and digits) is recognized. Bare
QuickConnect, reserved service names, deeper/direct hostnames and custom DSM
addresses receive only the two fixed HTTPS portals; no NAS alias is guessed.
An unsupported or noncanonical source does not gain these defaults. Later
global/www hops retain the original connection's identity instead of learning
a new alias from a redirect.

For that recognized original alias, the same checkbox also permits anonymous
navigation to `https://<alias>.direct.quickconnect.to:5001` or `:5002`, and
`https://<label>.<alias>.direct.quickconnect.to:5001` or `:5002`. The optional
prefix is exactly one valid ASCII DNS label, including an address-encoded
label; it cannot contain another dot. This is not `*.quickconnect.to`: another
NAS alias, deeper labels, HTTP direct URLs, other ports, lookalike suffixes,
userinfo and trailing-dot hosts do not match. Direct-host navigation retains
the original connection's owner and alias across subsequent handoffs. Starting
from an unrecognized direct hostname does not guess a NAS alias.

These destinations have a narrow exception to the general cross-origin and
HTTP-downgrade review switches. **Require HTTPS upstream always takes
precedence**, including for the built-in HTTP alias. Defaults permit anonymous
handoffs without repeated destination review; they do not approve forwarding
a saved login. Configured login forwarding still requires its separate explicit
approval. Source cookies, secret headers, query additions and certificate pins
are not inherited by the destination.

Each hop still uses a one-use native redirect receipt and a fresh protected
proxy session, with HTTPS trust checked independently. There is no direct
browser fallback, native cross-origin follow, blanket QuickConnect grant or
general subresource permission. Changing the original source, opting out,
or invalidating the document cancels stale default receipts. Disabling defaults
does not delete explicitly trusted destinations; those remain subject to the
general redirect policy. The derived runtime origin context is not saved or
imported as connection policy.

### QuickConnect discovery and learned probes

The same checkbox also permits a closed, anonymous initial discovery operation for
a recognized original NAS alias: **POST
`https://global.quickconnect.to/Serv.php`**. This is an API request made before
the website chooses its next page, not a redirect. Merely trusting a redirect
destination does not authorize this API.

When the selected website is the exact HTTPS global portal, its relative
`/Serv.php` URL and the equivalent already-rewritten local URL use that same
discovery endpoint. This preserves native response learning after a portal
handoff; it does not reinterpret `/Serv.php` on another website or accept extra
paths, query parameters or fragments as discovery requests.

The document client maps this exact, query-free URL to a reserved endpoint on
the session's protected loopback proxy. Native validation accepts only the
two-entry `get_server_info` JSON request for `mainapp_https` then
`mainapp_http`, with both `serverID` values matching the original alias,
`version: 1`, both stop flags false, and `is_gofile: false`. Both path values
must match and be a bounded single safe segment. Custom DSM hosts, reserved
portal names and unrecognized/deeper aliases do not gain discovery access.

The separate native client uses verified OS-root/hostname TLS and the
configured HTTP(S) proxy. It never carries the NAS login, cookies, custom
headers, query additions, client certificate, certificate pin or disabled
certificate checks. It follows no upstream redirects and has no direct retry.
The response is bounded JSON, not an executable page or arbitrary resource;
the only retained provider response header is a validated `X-QC-CLIENT-IP` address.
Requests require the protected origin and current primary-document identity;
navigation, opt-out and session closure invalidate their authority.

Successful verified control replies can enroll two additional route types in
a private native registry for the **same original alias and current document**:

- `sites[]` may name a single-label `<site>.quickconnect.to` control host, such
  as `dec.quickconnect.to`. Only its query-free HTTPS port-443 `/Serv.php` route
  is enrolled, and it accepts the same exact two-entry `get_server_info` POST
  schema. A syntactically matching hostname alone is not permission.
- `smartdns.host`, `smartdns.lan` and `smartdns.lanv6` may supply same-NAS direct
  hosts matching the namespace above. Only explicitly returned
  `service.port`/`service.ext_port` values of 5001 or 5002 can enroll the exact
  bodyless HTTPS GET `/webman/pingpong.cgi?action=cors&quickconnect=true`.
  A different nonempty `server.pingpong_path` is not substituted or relayed.

The registry retains at most 16 exact control URLs and 32 exact probe URLs.
Independent one-use learning tickets are bounded to eight; concurrent valid
responses for the same document can add routes without discarding each other's
results. Navigation or session revocation prevents old tickets and grants from
being reused. Returned opaque `serverID` fields are not assumed to equal the
requested NAS alias. The request's validated original alias remains authority.

A cached regional control host can be the page's first request. If that exact
regional POST lacks a current-document grant, native routing first validates
its body and performs one discovery exchange with the fixed global provider
using the same validated body. It forwards to the region only if that verified
reply advertises it. This warm-up shares the existing concurrency, deadline
and document-revocation limits; it is not recursive and never bootstraps a cold
direct GET probe. An unadvertised region remains refused without contacting it.

Handled discovery failures include fixed, secret-free diagnostic codes in the
bounded proxy request log. For example, `quickconnect_destination_not_discovered`
means no current grant, `quickconnect_stale_document` means document authority
ended, and `quickconnect_upstream_status` preserves a provider's HTTP error.
A validated but uncontacted candidate is labelled **Attempted**, with only its
canonical origin and operation. A completed global warm-up has its own entry;
if it fails, the attempted regional entry can carry that same failure without
implying the region was contacted. Request bodies, headers, destination queries
and provider error contents are never copied into these diagnostics.

For probes, the native client sends the real source origin, not the local proxy
origin. It requires one `Access-Control-Allow-Origin` value permitting that
source or anonymous `*`, and JSON `ezid` equal to the vendor's MD5-of-alias
correlation value before returning the response to the same-proxy page. That
correlation is **not** certificate verification or authentication. Browser GETs
without `Origin` are accepted only on the discovered route with exact
same-origin Fetch Metadata, protected Host and the current document header;
a present mismatched or malformed Origin is still refused.

These routes share limits of 4 KiB per request, 256 KiB per response, two
simultaneous exchanges, eight admitted requests, a 15-second network deadline
and a 20-second overall deadline. All still use the separate verified,
credential-free client described above. Learning a probe does not authorize
general resources, grant a TLS exception or forward a login; the separately
enabled direct **navigation** pattern does not itself enroll a probe URL.
Clearing the default-destinations checkbox removes both built-in navigation
and discovery authority; independently saved redirect trust remains separate.

Other `/Serv.php` commands such as `request_tunnel`, long-poll wakeup endpoints,
arbitrary LAN/IP probes, other paths or ports, and a general URL relay remain
unsupported. Those requests still need distinct reviewed routing and may
prevent a complete QuickConnect connection. The public homepage's normal alias
navigation is separate from discovery. No live NAS or complete relay-login
compatibility is claimed.

## Foreign origins and unsupported traffic

Third-party origins are currently **blocked, not transparently proxied**, except
for the closed initial/learned QuickConnect routes above and public-font
capability below.
This includes a CDN or API that an otherwise trusted page references. A trusted
redirect destination is not automatically an approved subresource origin or
TLS identity. Supporting such origins requires a separate origin mapping and
trust decision; arbitrary URLs are not sent through a generic native fetch
endpoint under the authenticated page's origin.

### Reviewed Synology public fonts

All embedded web sessions include one built-in, anonymous capability for the
28 fixed HTTPS files at
`https://synostatic.synology.com/font/inter/inter-w{400,500,600,700}-{1..7}.woff2`.
It works for manual DSM, plain HTTP(S), and reverse-proxy connections without
requiring saved credentials or selecting an application profile. It does not
approve the CDN origin generally, any other filename, query, or redirect.

The browser loads the fonts through its protected local proxy. Native response
rewriting handles exact URLs in decoded CSS, inline styles and scripts; the
document bridge also handles supported dynamic CSS, `FontFace`, and exact GET
fetch/XHR binary loaders. `font-src 'self' data: blob:` stays in force: the CDN
is never added to the browser's CSP allowlist.

The font route uses a separate cookie-free client with OS-root and hostname
verification, including for an HTTPS upstream proxy. It follows the configured
HTTP(S) proxy but never inherits the website's credentials, cookies, custom
headers, query parameters, certificate pin, or disabled certificate checks.
Only GET is accepted; response redirects are refused. The maximum is 512 KiB
per font, four simultaneous downloads and 32 outstanding requests, with a
30-second overall deadline. MIME and bounded WOFF2 container-header checks are
required; responses are normalized to `font/woff2` with `nosniff`, without
upstream cookies or redirect headers. These checks are not a font decoder or
a claim that arbitrary font files are sanitized.

If verified font-client setup is unavailable, only the font route fails with
503; the main website can still load. A download failure never switches to
direct CDN loading or unverified TLS. Session closure cancels outstanding font
reads. Other blocked resource or unsupported-API notices remain meaningful and
are not hidden by this exception.

Mandatory response CSP restricts resources, connections, frames, and forms to
the session origin and its local WebSocket endpoint. It applies to assets and
error responses as well as successful pages, regardless of website script
settings. DNS prefetch is disabled on these responses. This may make pages
depending on foreign services report blocked resources or remain incomplete.

Workers, SharedWorkers, service-worker registration, WebRTC, and WebTransport
are not supported by this embedded routing slice. Worker creation is blocked
by response policy, and the document client refuses unsupported constructors.
The three RTC constructor aliases (`RTCPeerConnection`,
`webkitRTCPeerConnection`, and `mozRTCPeerConnection`) are presented as
unavailable where the host permits masking them. A truthy throwing replacement
would incorrectly advertise support and crash optional feature detection.
QuickConnect, for example, checks the prefixed aliases before using ICE host
candidates for optional same-subnet discovery; their absence lets that probe
stay empty while its normal HTTPS WAN/relay branches remain available. No RTC
transport, HTTP origin, or certificate trust is approved by this behavior.

If a native host property cannot be masked, the bridge reports an unavailable
interceptor. That advisory error is not a containment mechanism, and throwing
an exception alone cannot stop parser-initiated networking. This compatibility
limitation must not be interpreted as a safe direct-connection fallback.
JavaScript wrappers are compatibility controls that a page can tamper with;
they do not prove containment of WebRTC, every alternate realm, speculative
engine traffic, or other browser-internal connections. No process-wide egress
firewall or isolated browser-network context is claimed.

On Windows, native frame navigation permits only registered live proxy origins
and blank/srcdoc frames. The native pre-request filter observes **all HTTP(S)
resource categories**, but its enforcement remains **document-only**: it refuses
unapproved document requests with a local 403 response; it also permits the
compiled application origin needed to bootstrap the main shell. Frame checks
still refuse embedding that application origin. Popups and external navigation
are denied. Frame-navigation cancellation alone is insufficient: a browser can
start a request before delivering that event.

The additional observation does not reroute, allow, cancel or change general
subresource requests. It leaves existing shell requests and Tauri handlers
unchanged. It does not cover WebSockets, and speculative TCP connections remain
possible. It is not an all-network
firewall. Other platforms report the native guard as unsupported rather than
claiming equivalent enforcement. Mandatory CSP and the document client do not
replace that missing platform guarantee.

The expanded protection details offer a native HTTP snapshot, refreshed on
opening or explicit **Refresh snapshot**, with no background polling. It is
application-wide WebView traffic, not traffic attributed to the selected tab,
and does not include native proxy/upstream requests or other application
services. Its in-memory ring retains at most 64 entries, evicting the oldest;
snapshots display the newest entries first. Invalid/oversized entries and
observations lost to diagnostic lock contention
are omitted. Counters cover recorded observations, not every engine request.
Only canonical destination origins, fixed method/resource/source categories,
and known document-denial outcomes are retained. No paths, queries, fragments,
userinfo, headers, bodies or credentials are retained or logged. An observed
request is not evidence of a successful response or a permitted proxy route.
Categories are reported by the engine: WebView2 can classify a JavaScript
`fetch()` as `xhr`; the application does not relabel it from an inferred caller.
The ring lasts for the application process, independently of individual tabs.

The WebView2 request event has no trusted initiating frame/session identifier.
`Referer` is not sufficient authority. Full session-owned interception would
need an isolated per-session WebView or a verified native/CDP frame-to-owner
mapping, plus explicit handling of other browser channels. Neither architecture
is implemented by these diagnostics. The same-origin proxy, CSP and approved
closed routes remain unchanged; there is no new direct fallback.

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

Protection details also show the page routing module's **v3 acknowledgement**
for fixed QuickConnect navigation, initial discovery, learned routes and
same-NAS direct navigation. Its four boolean capabilities are compared with
the current connection after the existing primary-document identity checks.
A missing/older acknowledgement or a settings mismatch is diagnostic guidance,
not permission to replay a request or bypass trust. Restart the desktop process
after native updates; refreshing the application UI cannot replace an older
native proxy's injected module. Even a current v3 acknowledgement is not proof
that every browser request or channel is captured.

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
revocation, and response-policy coverage. `http_websocket_acceptance_tests.rs`
adds real plain/TLS-plus-CONNECT binary, fragmented, ping/pong, close and
subprotocol exchanges, rejection status fidelity and secret-safe bounded logs.
`http_websocket.rs` includes raw-query and one-way-traffic idle regressions.
Existing HTTP response, TLS, and reviewed
redirect fixtures remain relevant. These tests do not contact user sites,
install trusted roots, prove compatibility with every website, or establish
zero browser-engine egress. Native app compilation and actual platform guard
acceptance are separate gates.

`http_synology_redirect_tests.rs` covers the exact built-in destinations,
HTTPS-only precedence, opt-out and original-source/document revocation, and
sequential protected QuickConnect handoffs. Its local tripwire verifies that
receipt creation sends no upstream or destination request; it does not perform
a live QuickConnect or NAS login.

`http_font_asset_tests.rs` checks actual native CSS/HTML/JS rewriting, closed
asset names, binary MIME/size/signature refusal, anonymous CONNECT routing,
independent TLS rejection, and stop-time cancellation. Its positive transport
uses an isolated fixture certificate, not a system trust-store modification;
the installed-Edge fixture separately verifies actual font decoding.

From the repository root, `node scripts/test-web-network-browser.mjs` exercises
the compatibility bridge in installed headless Edge using synthetic endpoints.
This is not a native-proxy or whole-engine containment test. The ambient-proxy
regression above changes proxy environment variables only in an isolated test
child process, never in the application or the shared test process.

The optional RTC probe was checked against published QuickConnect webpack
module 411 in
[`connect_lib.da3fae9c5d057ef58d3a.bundle.js`](https://quickconnect.to/connect_lib.da3fae9c5d057ef58d3a.bundle.js)
(SHA-256 `96313fa8483c84482196c16c8bef073da181564849769f16ae56f51ff81383cd`,
anonymous source inspection on 2026-09-11). An isolated VM executed that module
without the application entrypoint or network APIs: the truthy blocked stub
threw during construction; absent aliases made zero RTC calls, returned no
local addresses, and retained its HTTPS WAN branch for synthetic inputs.
Committed tests use a minimal synthetic equivalent rather than copying the
vendor module. This is source/branch evidence, not a live NAS login or proof
that every WAN/relay endpoint is permitted by the separate proxy policy.
