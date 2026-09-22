---
title: Embedded browser proxy routing
description: Session-owned HTTP and WebSocket mediation, QuickConnect routing, and embedded browser security boundaries.
hide_page_header: true
---

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

The same original alias can also navigate anonymously to
`https://<alias>.<region>.quickconnect.to` on port 443, including a return to
its original regional address. The region is exactly two lowercase letters
followed by 1–61 digits (one DNS label). Other aliases, HTTP regional URLs,
custom ports and deeper names are not included. Each handoff still requires
its native receipt, original owner/provenance and independent TLS checks.

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

The saved Synology **Automatic form login** flow has a separate, one-use native
intent: after a verified same-NAS HTTPS handoff and matching primary DSM login
page, it can resume the original form login without sending it to a portal or
copying credentials onto the anonymous connection. This does not enable general
credential forwarding or share cookies across origins. See
[DSM website sign-in](synology-file-station-sessions.md#dsm-website-sign-in)
for the original-connection, expiry and reopen requirements.

Each hop still uses a one-use native redirect receipt and a fresh protected
proxy session, with HTTPS trust checked independently. There is no direct
browser fallback, native cross-origin follow, blanket QuickConnect grant or
general subresource permission. Changing the original source, opting out,
or invalidating the document cancels stale default receipts. Disabling defaults
does not delete explicitly trusted destinations; those remain subject to the
general redirect policy. The derived runtime origin context is not saved or
imported as connection policy.

Synology DSM and recognized QuickConnect website connections permit up to
20 reviewed cross-origin handoffs in the original navigation chain. Their
native HTTP requests also permit up to 20 same-origin redirects; the existing
overall request deadline is unchanged. Ordinary websites retain five reviewed
handoffs and ten same-origin redirects. The Synology budget follows the original
connection's live owner/identity provenance, not a later destination's name,
and survives an anonymous handoff or proxy restart without forwarding a login.
Turning off default destination approval does not change this budget: each
destination still needs its normal approval, and the twenty-first redirect is
refused. WebSocket and Synology API redirect refusals are unchanged.

An issued default-destination handoff uses a neutral HTTP 202 pending response,
not an access-denied warning. The app validates the native receipt and current
consent before showing “Continuing to approved destination”. This is not a TLS
or login approval: configured saved-login forwarding still opens manual review.
Receipt checking and automatic continuation each have a 15-second total waiting
deadline. Missing, expired or changed authority restores review/retry controls;
late replies cannot launch a destination. Other review requests and actual policy
refusals retain their existing responses.

The proxy tracks the active session and its cookie jar. Same-session requests
can reuse that jar. A QuickConnect attempt also retains bounded **exact-origin**
state across approved anonymous handoffs: returning to the same HTTPS origin
can recover its own server cookies and four provider route hints (`previous`,
`previous_verify_type`, `tunnel`, `client_ext_ip`). The destination never receives
another origin's cookies. Different currently approved TLS identities discard
the corresponding origin's retained jar; each destination still gets a newly
verified transport. Discovery/probe identity proofs remain document-scoped.

Within a same-origin redirect chain, newly issued server cookies supersede
stale incoming browser values. Server-declared paths and deletions are preserved. The
final response also delivers intermediate cookie updates to the browser, in
issuance order before the final response's updates. Valid upstream Domain
attributes become host-only cookies on that session's isolated proxy host;
expiry, path, Secure, HttpOnly and SameSite attributes are preserved. This does
not share a cookie jar across different upstream origins.

If an incoming request has several cookies with the same name and a server
update cannot identify their scopes, the proxy does not guess which one to
replace. It stops that ambiguous exchange with instructions to clear the
session cookies and retry; clearing still requires the user's action. The
browser's Cookie header does not contain the missing path/domain information.
This is not complete browser cookie-scope virtualization: even one browser-only
cookie does not reveal its original scope, and projecting same-name/same-path
cookies from different upstream Domain scopes can collapse that distinction.
The native website jar sends matching cookies longest-path-first while
preserving same-name duplicates; ordering between equal-path cookies with
different domains or creation times remains unspecified.

This volatile continuity uses a one-use native ticket from a consumed redirect
receipt, an explicit source-session transfer, and exact destination/path, route
and original-policy checks. The ticket is not a saved/exported connection field.
It expires after 120 seconds; close, clear-session, cancelled handoff and failed
start discard it. A logical attempt is bounded to twenty handoffs. Server jars
are limited to 128 cookies/64 KiB per origin; only the four named JavaScript
hints are restored to a fresh loopback origin. Browser storage as a whole is not
copied. **Open anonymously in a new tab** always starts without this retained
state. Explicit saved-login forwarding also starts a fresh attempt instead of
silently combining these permissions. Frontend database ownership checks remain
required; this mechanism is not a separate native database-authorization layer.

A marked primary regional page that serves the recognized versioned connector
on three separate handoffs stops with `quickconnect_connector_restart`, instead
of cycling indefinitely. Ordinary repeated login URLs, duplicate requests and
child frames do not count. Reaching DSM application HTML under `/webman/` clears
that connector-cycle history. This guard diagnoses non-convergence; it does not
claim to detect authentication success or every possible provider loop.

HTTP redirects need separate tracking: a regional server can return a redirect
before any connector HTML is received. A successful regional NAS probe does not
rule this out. That probe checks the identity endpoint under `/webman/`; opening
the website is a different request, with a different path and browser context.
Repeated regional-to-alias handoffs are not evidence that the NAS is offline,
and increasing the redirect allowance does not repair the handoff.

For the anonymous, root-only regional → HTTP alias → HTTPS alias → same
regional circuit, native receipt consumption tracks both HTTP and vendor-script
handoffs. A third unchanged regional restart stops with
`quickconnect_redirect_loop`. Changes to the regional website's cookie state
or the attempt's separate provider-control cookie state reset the circuit
count. Comparison ignores ordering between distinct browser cookie names and
expiry renewal, but preserves ordering between same-name browser cookies.
Native cookie scope and attributes remain part of the comparison. Cookie values
and the in-memory comparison digest are never logged, and provider cookies are
not copied into the website jar. This is bounded cookie-state evidence, not proof
that all provider session state is unchanged. Non-root
and authenticated flows are excluded, and a vendor handoff needs evidence of
the current successful primary root document, rechecked when its receipt is
read and consumed. Child-frame requests made before the handoff, including
marked children, neither replace that evidence nor break it merely by advancing
the request sequence. Pending receipts still expire or become stale when their
own request/primary-document checks change. This is a bounded stop, not a claim that the
underlying relay problem has been repaired or that sign-in succeeded.

The “proxy
keepalive” health check tests the local proxy listener and can restart a dead
proxy when configured. Transport TCP keepalive is not a DSM login heartbeat;
neither mechanism prevents a remote application session from expiring.

### QuickConnect discovery, same-NAS probes and bounded tunnel setup

The same checkbox also permits a closed, anonymous initial discovery operation for
a recognized original NAS alias: **POST
`https://global.quickconnect.to/Serv.php`**. This is an API request made before
the website chooses its next page, not a redirect. Merely trusting a redirect
destination does not authorize this API.

When the selected website is the exact HTTPS global portal, its relative
`/Serv.php` URL and the equivalent already-rewritten local URL use that same
discovery endpoint. This preserves the bounded discovery route after a portal
handoff; it does not reinterpret `/Serv.php` on another website or accept extra
paths, query parameters or fragments as discovery requests.

The document client maps this exact, query-free URL to a reserved endpoint on
the session's protected loopback proxy. Initial discovery validation accepts the
two-entry `get_server_info` JSON request for `mainapp_https` then
`mainapp_http`, with both `serverID` values matching the original alias,
`version: 1`, both stop flags false, and `is_gofile: false`. Both path values
must match and be a bounded single safe segment. Custom DSM hosts, reserved
portal names and unrecognized/deeper aliases do not gain discovery access.

The separate native client uses verified OS-root/hostname TLS and the
configured HTTP(S) proxy. It never carries the NAS login, website/browser cookies, custom
headers, query additions, client certificate, certificate pin or disabled
certificate checks. It follows no upstream redirects and has no direct retry.
The response is bounded JSON, not an executable page or arbitrary resource;
the only provider response header exposed to the page is a validated
`X-QC-CLIENT-IP` address.
Requests require the protected origin and current primary-document identity;
navigation, opt-out and session closure invalidate their authority.

Discovery and tunnel control POSTs have a separate, volatile native cookie
store. A validated provider response can retain cookies for later control
requests to that **exact HTTPS origin**, bound to the original NAS alias. Even
a provider cookie with `Domain=quickconnect.to` is not sent to another provider
origin, a NAS page or a probe. This store never imports browser cookies, shares
the website cookie jar, exposes `Set-Cookie` to the page, or copies cookie
values into diagnostics. Direct and regional probes remain anonymous: they
neither send nor retain these cookies.

Cookie updates are committed only after a bounded, non-redirect JSON response
passes validation, while both the issuing document and attempt generation are
still current. Prefix, issuer-domain/public-suffix, path, expiry and deletion
rules apply. Limits are eight provider origins per store and 32 cookies/16 KiB
per origin; a response is limited to 32 cookie headers/16 KiB, with at most
4 KiB per header. Over-limit updates do not partially replace retained state.
The store survives a valid consumed handoff within the same native attempt,
but closing, clearing or ending that attempt discards it; failed or expired
continuations cannot restore it. Without an attempt, cookies remain local to
that proxy session and are cleared on revocation. A new document must obtain
fresh request authority even when the attempt retains provider cookies.
This bounded compatibility support is not browser-wide cookie sharing and is
not evidence that a live QuickConnect relay or login loop has been resolved.

For a recognized original NAS alias, the default setting explicitly permits
closed control POSTs at `https://<single-label>.quickconnect.to/Serv.php`,
with default port 443 and no query or fragment. This includes regional control
hosts such as `dec.quickconnect.to` without requiring a preceding `sites[]`
advertisement. The permission is scoped to the provider's DNS namespace and
the exact validated operation for the original alias/current document; a host
matching that namespace is not itself proof that it is a regional server.
It does not authorize other paths, methods, resources or credential forwarding.

The same default preference permits the exact bodyless HTTPS GET
`/webman/pingpong.cgi?action=cors&quickconnect=true` at
`<alias>.direct.quickconnect.to:5001` or `:5002`, optionally with one valid DNS
label before the original alias. It also permits that fixed GET at
`<alias>.<region>.quickconnect.to:443`, with the same original-alias and bounded
region-label rules as regional navigation. Once a regional host is the current
website, its own requests keep using the ordinary protected same-origin route.
These destination permissions do not depend on a prior discovery reply
or a transient learned-route registry. Other aliases, paths, queries, methods,
HTTP and ports remain refused. A returned `server.pingpong_path` cannot expand
the route. Original-source policy and current primary-document identity remain
mandatory; navigation, opt-out and session revocation invalidate old requests.

A cached provider control host can be the page's first request. Its bounded
operation is sent directly through the configured proxy after validation;
there is no synthesized global warm-up, control-host learning prerequisite or
automatic replay. Discovery and tunnel responses do not grant additional
origins or probe permissions.

For an authorized regional control endpoint, the same checkbox also permits a
single-element JSON array containing exactly eight `request_tunnel` fields:
`version: 1`, `command: "request_tunnel"`, `stop_when_error: false`,
`stop_when_success: true`, `id: "mainapp_https"` or `"mainapp_http"`, the original alias in
`serverID`, `is_gofile: false`, and the bounded safe `path` (which may be empty).
Extra fields, other commands, batching and other service IDs are refused.
The fixed global control endpoint cannot receive this operation.

Tunnel setup is sent once to the requested eligible provider control host.
It **does not send or replay `request_tunnel` to global**, including through
the generic provider-control route. There is no automatic tunnel retry, redirect
following, alternate route or direct-network fallback. It retains the same
anonymous client, configured proxy, verified TLS, size/deadline/concurrency and
document-revocation bounds as discovery.

Tunnel responses do not enroll additional origins or resource permissions.
Supporting this setup command does not mean all subsequent relay pages,
subresources or wake-up commands are supported; those retain their separate
routing and trust requirements.

Handled discovery failures include fixed, secret-free diagnostic codes in the
bounded proxy request log. Older builds reported `quickconnect_destination_not_discovered`
when a probe was absent from the former learned-route registry. Current exact
same-NAS probes do not require that registry. `quickconnect_stale_document` means document authority
ended, and `quickconnect_upstream_status` preserves a provider's HTTP error.
A validated but uncontacted candidate is labelled **Attempted**, with only its
canonical origin and operation, without implying that the server was contacted.
Request bodies, headers, destination queries
and provider error contents are never copied into these diagnostics.

For probes, the native client sends the real source origin, not the local proxy
origin. It requires one `Access-Control-Allow-Origin` value permitting that
source or anonymous `*`, and JSON `ezid` matching a current-document NAS identity
before returning the response to the same-proxy page. The original alias's MD5
correlation remains accepted for compatibility. Successful verified discovery
or tunnel replies may additionally supply the vendor's `server.serverID`: only
HTTP-success replies with numeric `errno: 0` and the reviewed complete server,
service and environment field shape qualify. The native client keeps at most
16 MD5 correlation hashes for the original alias and current primary document;
source IDs must be nonempty, at most 256 UTF-8 bytes and contain no control
characters. No raw ID is retained by this registry, logged or persisted.
Document replacement makes prior hashes unusable, and session revocation clears
them. These identity receipts never grant URLs, ports, resources or credentials.
The correlation is **not** certificate verification or authentication. Browser GETs
without `Origin` are accepted only on the protected probe route with exact
same-origin Fetch Metadata, protected Host and the current document header;
a present mismatched or malformed Origin is still refused.

These routes keep the 4 KiB request and 256 KiB response limits, but use separate
capacity so slow direct candidates cannot delay discovery or relay setup:

| Work                     | Active / admitted | Queue limit | Network limit | Overall limit |
| ------------------------ | ----------------- | ----------- | ------------- | ------------- |
| Discovery / tunnel setup | 2 / 4             | 2 seconds   | 25 seconds    | 29 seconds    |
| Direct NAS probes        | 4 / 8             | 1 second    | 4 seconds     | 5 seconds     |
| Regional relay probes    | 1 / 4             | 1 second    | 12 seconds    | 14 seconds    |

The network deadline includes connection/TLS and response reading. A failed
direct candidate does not cancel independent relay work. No automatic replay
is added; stale documents cancel their own queued/active exchanges. All still
use the separate verified,
credential-free client described above. The probe capability does not authorize
general resources, grant a TLS exception or forward a login; direct
**navigation** still uses a separate one-use handoff receipt.
Clearing the default-destinations checkbox removes both built-in navigation
and discovery authority; independently saved redirect trust remains separate.

Other `/Serv.php` commands, long-poll wakeup endpoints,
arbitrary LAN/IP probes, other paths or ports, and a general URL relay remain
unsupported. Those requests still need distinct reviewed routing and may
prevent a complete QuickConnect connection. The public homepage's normal alias
navigation is separate from discovery. No live NAS or complete relay-login
compatibility is claimed.

## Reading the proxy log

Expand a request to see its phase, stage, outcome and total duration. Where
available, queue time, active exchange time and the received upstream status
are shown separately. A log-safe attempt identifier and hop number join
QuickConnect handoffs across changing proxy session IDs. They are not reusable
continuation tickets. Ordinary HTTP entries are updated after body reading, so
a decoding failure is not left labelled as a successful response.

QuickConnect errors distinguish capacity/queue limits, connection failure, TLS
failure, exchange timeout, incomplete reads, redirects, CORS validation,
encoding/size/JSON errors and NAS identity mismatch. A candidate probe failure
is not proof that the whole connection failed; an HTTP 200 is not proof of
sign-in. Unknown transport failures remain explicitly unknown rather than
being guessed from sensitive raw exception text.

For example, a regional relay probe returning 200 followed by a page handoff
back to the HTTP alias, then the HTTPS alias, then the regional relay, is a
discovery cycle. The native 202 means the app is preparing a destination
handoff; it is not the upstream server's redirect status. Inspect the redirect
details rather than treating the probe's 200 as proof that DSM loaded. Direct
candidate timeouts can occur independently while the relay is reachable.

Redirect details include the actual upstream redirect status, source and
destination origins, root/DSM/other path categories, the number of internal
same-origin redirects, and whether a query or fragment was removed. They do
not retain the actual paths, parameter values, Location header, or cookies.

**Copy last 1,000** includes this structured diagnostic information with stable
per-copy attempt aliases. It excludes request paths, query strings, headers,
bodies, cookies, credentials and continuation tickets. Older entries without
the new metadata remain readable. These native proxy exchange results are
separate from the application-wide WebView observation snapshot, which cannot
prove response success or full browser-network interception.

## Foreign origins and unsupported traffic

Third-party origins are currently **blocked, not transparently proxied**, except
for the closed QuickConnect control/probe routes above, the reviewed Tactical RMM
API route below, and public-font capability below.
This includes a CDN or API that an otherwise trusted page references. A trusted
redirect destination is not automatically an approved subresource origin or
TLS identity. Supporting such origins requires a separate origin mapping and
trust decision; arbitrary URLs are not sent through a generic native fetch
endpoint under the authenticated page's origin.

### Reviewed Tactical RMM API origin

A connection using the reviewed Tactical RMM application preset receives one
ephemeral background-request capability. For an HTTPS dashboard at
`https://rmm.example.com`, it permits default-port HTTPS fetch/XHR requests to
the exact common origins `https://api.rmm.example.com` and
`https://api.example.com`. A connection may instead add one explicitly reviewed,
canonical HTTPS API origin for a nonstandard deployment. The browser maps only
this bounded set to a protected loopback endpoint; native code independently
validates the profile, source host, active document and full destination before
egress.

The capability does not use broad suffix matching and cannot be selected by a
generic website or malformed imported profile. It rejects navigation, WebSocket,
workers, WebRTC, WebTransport, credentials in URLs, nondefault ports, fragments,
unlisted sibling hosts and redirects outside the exact API-origin set. It is
revoked when the owning document or proxy session changes.

The API uses a dedicated native client with normal certificate verification, an
independent cookie jar, the configured upstream network proxy and the connection's
minimum TLS floor. It never inherits the dashboard's certificate bypass or pin.
Source cookies, custom headers, saved proxy/form credentials and connection query
parameters are not copied across origins. Tactical's own `Authorization` header is
forwarded; upstream `Set-Cookie` stays in the API jar and is not exposed under the
loopback browser origin.

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
and blank/srcdoc frames. Its pre-request filter also enforces the same exact
origin policy for every intercepted HTTP(S) resource category and source,
including page fetch/XHR, parser and dynamic resources, and worker HTTP(S)
requests. It permits only the compiled application origin, Tauri's exact IPC
origin, and live protected proxy leases; rejected requests receive a local 403
before response data is available. Popups and external navigation are denied.

This Windows callback is defense in depth, not the portable routing mechanism.
All platforms retain the protected same-origin proxy, mandatory response CSP,
and page routing hooks; unsupported workers and socket APIs are disabled or fail
closed, with no direct-network fallback. The Windows callback does not cover
WebRTC or other arbitrary socket transports, and speculative empty TCP
connections can still occur. Other platforms report the native guard as
unsupported rather than claiming an equivalent OS-specific callback.

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

Protection details also show the page routing module's **v6 acknowledgement**
for fetch, XHR and portable page mediation, the bounded Tactical API-origin set,
fixed QuickConnect navigation, initial discovery, same-NAS probes and same-NAS
direct/regional navigation. These capabilities are compared with the current
connection after the existing primary-document identity checks.
A missing/older acknowledgement or a settings mismatch is diagnostic guidance,
not permission to replay a request or bypass trust. Restart the desktop process
after native updates; refreshing the application UI cannot replace an older
native proxy's injected module. The acknowledgement is advisory: strict CSP and
native proxy destination validation remain independent enforcement boundaries.

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
