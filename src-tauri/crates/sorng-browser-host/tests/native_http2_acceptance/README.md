# Local HTTP/2 acceptance

This opt-in Windows fixture uses the production private request context, native
TLS admission factory, an ephemeral private CA, and the owned authenticated proxy.
Every destination resolves through a numeric loopback route. It uses no saved
database, account, system trust change, public website, or direct fallback.

The server advertises HTTP/2 and HTTP/1.1, actually parses H2 frames, and handles
each stream independently while continuing to drive the shared connection. Two
independent private contexts run the same 0/8/32-image and 0/80-ms response matrix.
The H2 run must observe more than six simultaneous held requests; ALPN alone does
not pass. Receipts retain connection IDs, request start/end times, observed ALPN,
peak outstanding streams, native proxy counters, and shutdown completion.

Use a fresh output directory and unique run ID with the existing sanctioned
private-desktop acceptance launcher. Stage an immutable DLL into each reviewed
runtime bundle; never replace the application's selected runtime in place.

- Default: require exact bridge revision 2 and real H2 multiplexing.
- `SORNG_CEF_HTTP2_EXPECT=legacy`: require exact revision 1 and its H1 ceiling.
- `SORNG_CEF_HTTP2_EXPECT=h1`: revision 2 with a server offering H1 only.
- `SORNG_CEF_HTTP2_CHECK=cross-authority`: half the image requests target a
  second SAN-covered authority. Its route is admitted, but its native TLS
  decision is denied. Any such request reaching the H2 server fails acceptance.
- `SORNG_CEF_HTTP2_CHECK=deny`: reject the initial native TLS admission; require
  zero application bytes and zero HTTP requests in both contexts.
- `SORNG_CEF_HTTP2_CHECK=delay`: hold each native admission for at least 300 ms;
  require zero application bytes before approval, then normal multiplexing.
- `SORNG_CEF_HTTP2_CHECK=revoke`: observe a real H2 page and periodic image
  heartbeat, revoke both owners, and require sockets to close before browser
  teardown, rejected subsequent navigation, and no further server requests.
- `SORNG_CEF_HTTP2_CHECK=wss`: an H2 page opens a WSS socket, exchanges a bounded
  masked text frame with an H1-upgrade echo server, then confirms it over H2.

The Windows `build.rs` must retain the canonical final-client delay-load helper.
Without it, sandboxed children eagerly load browser-only DLL dependencies and
can fail DLL initialization before the renderer or any TLS fixture executes.

Keep the legacy/H2 comparison settings identical. Synthetic page timings measure
this fixture and its private event loop, not all public websites. This fixture
does not establish HTTP/3 support or authenticated application behavior.
