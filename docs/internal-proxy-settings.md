# Internal Proxy settings

Settings → Internal Proxy manages both the legacy HTTP mediator and native CEF
relay. Saved transport changes apply to new sessions; reload keeps an existing
session's snapshot. Reconnect the browser connection to apply new transport or
DNS settings. Native settings come from managed saved settings, not a page or
renderer-supplied relay configuration.

- Connect and request deadlines, pool idle lifetime and idle connection limit.
- TCP no-delay and socket keepalive, independently of app health checks.
- Native relay client limit, header size and header/write/HTTP idle deadlines.
- OS DNS address-family preference or restriction, lookup deadline, private
  per-attempt cache lifetime and capacity, cache invalidation and counters.
- Existing device-local page-cache enablement, size budgets, usage, lock-time
  clearing and clear-all actions. HTTPS disk caching requires active backend
  interception and native runtime support; capability reporting remains the
  authority. Connections retain their own cookie/cache overrides.

The native interception pool honors the saved pool lifetime and idle limit;
active HTTP/1.1 response bodies retain their connection slots. Request timeout
bounds intercepted upstream response headers, including the request upload.
It does not impose a total lifetime on streaming bodies or upgraded WebSockets.
Plain HTTP relay bodies have their separately configurable no-progress limit.

Local DNS is used for the first socket endpoint only. Later destination names
continue inside the configured CONNECT/SOCKS/SSH route. OS DNS configuration is
unchanged: custom DNS servers, DoH and hosts overrides are not provided here.
The optional cache reuses successful results for the configured period rather
than interpreting authoritative DNS TTLs. Zero disables it; OS caches can still
apply. It caches no failures, expires and evicts bounded entries, never shares
results between attempts, and stays in memory. Clearing invalidates all app
proxy resolver caches for subsequent lookups, including results that were in
flight. Counters expose no queried hostnames. These controls do not flush the
operating system's cache or the DNS cache of a remote proxy/SSH server.

Bounds preserve existing native relay ceilings (256 clients and 16 KiB headers).
Settings do not widen origin grants, change certificate decisions, retry writes
on another route, or create a direct-network fallback. TLS profiles, certificate
compatibility and network paths remain connection settings.

## Error pages and work limits

The per-session HTTP/1 host cap is configurable from 1 to 64 (default 6).
HTTP/2 retains one multiplexed connection. DNS concurrency is configurable
from 1 to 16 per resolver; the process also retains its 16-job bound, including
OS lookups whose callers cancelled. These are admission/concurrency controls,
not a separate OS thread pool.

Native error pages can keep technical details collapsed or expanded and
include or omit native traces in the displayed/copied report. Website error
body conversion is off by default, with optional 5xx-only or 4xx-and-5xx modes.
Conversion preserves status, authentication challenges, Set-Cookie and
Retry-After headers; bodies and submitted requests are never replayed. Internal
reports do not include those header values. Settings includes a searchable
common-error reference. TLS alert 112 has a specific SNI/hostname explanation
and `tls-server-name-rejected` code. The pages identify the application internal
proxy and distinguish a website's own HTTP failure from a forwarding failure.
