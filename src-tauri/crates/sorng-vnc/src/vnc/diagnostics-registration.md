# VNC diagnostics integration

The VNC crate exports `vnc::diagnostics::diagnose_vnc`. No dependencies, state
registration, or main app `lib.rs` changes are needed.

`src-tauri/crates/sorng-commands-core/src/core_handler.rs` registers the command
with the following alias:

```rust
use crate::vnc::diagnostics as vnc_diagnostics;
```

The entry is in `GROUP_J_COMMANDS`, immediately after
`rdp_commands::diagnose_rdp_connection`, preserving the alphabetic ordering used
by the generated command predicate:

```rust
vnc_diagnostics::diagnose_vnc,
```

Frontend contract:

```ts
invoke<VncDiagnosticReport>("diagnose_vnc", {
  request: { host: "example.test", port: 5900, route: "direct" },
});
```

Request fields are strict; credentials and other unknown fields are rejected.
`route` is required and accepts `direct` or `blocked`. A blocked route returns
without DNS or sockets. No diagnostic is started during rendering or connection
failure handling. The frontend derives the route from the current connection
and session; saved proxies, tunnels, chains, VPN settings, and unknown connection
configuration fail closed. Retry has the same route guard.

The existing VNC engine and the shared raw-TCP runtime route resolver cannot
establish routed VNC streams. This patch does not add that transport capability.
It deliberately reports configured routes as unsupported instead of probing the
destination directly or creating/authenticating a tunnel. Direct checks use
system routing and the system resolver; they do not attest to an unmanaged VPN.

Bounds: at most two concurrent requests, DNS 3 seconds, up to four resolved
addresses sharing a 5-second TCP deadline, then a 2-second read of exactly 12
bytes. No RFB version reply, authentication, clipboard, input, or session is
sent/created. OS resolver work may outlive its cancelled async wait; the command
returns within its budget. Report fields are camelCase; code/status values and
protocol version are constrained, and raw socket errors/banners are omitted.

Older builds without this command report unavailability without exposing the
native error payload. Native fixture tests use loopback listeners; the reported
production endpoint was not tested.

Validation commands:

```text
npx vitest run tests/protocol/VncFailureDiagnostics.test.tsx tests/protocol/useVNCClient.test.ts tests/protocol/useVNCClient.activity.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml -p sorng-vnc --lib diagnostics::tests --locked
npx tsc --noEmit --pretty false
```
