# Native command wiring inventory

The registration checker follows handler modules reached by the real application
router, then extracts `generate_handler!` lists and macros that generate those
lists. Quoted strings, assertion fixtures, comments, and obsolete unreferenced
handler copies are not registrations. LLM and Telegram each have one
identifier-based command list, used by both their dispatch predicate and handler.

Run the normal contract gate:

```powershell
node node_modules/vitest/vitest.mjs run tests/ipc/invokeRegistration.test.ts tests/ipc/nativeCommandInventory.test.ts
```

For a complete source-derived command-name inventory, including every handler's
names and names with no resolved frontend reference, run:

```powershell
$env:IPC_INVENTORY = 'full'
node node_modules/vitest/vitest.mjs run tests/ipc/invokeRegistration.test.ts
Remove-Item Env:IPC_INVENTORY
```

`IPC_INVENTORY=1` emits counts and unresolved forwarding boundaries without the
full name lists. At the capability-wiring checkpoint this found 7,905 distinct
native names and 4,934 distinct resolved frontend names, with no missing native
registration. Counts are snapshots, not permanent assertions. This is **not** a
claim that every registered command has a visible UI, that every frontend file
is reachable, or that command arguments/state work under every build.

## Feature and state boundaries

The authoritative outer route gates are in `src-tauri/src/invoke_handler.rs`.

| Handler family                                          | Outer application feature | Default/lean | Full |
| ------------------------------------------------------- | ------------------------- | ------------ | ---- |
| Core, access, sessions, tray                            | Always routed             | Yes          | Yes  |
| Cloud                                                   | `cloud`                   | No           | Yes  |
| Collaboration                                           | `collab` OR `platform`    | No           | Yes  |
| Platform                                                | `platform`                | No           | Yes  |
| Ops, infrastructure, mail, services, tools, web servers | `ops`                     | No           | Yes  |

An outer route does not imply every operation is enabled. Database and protocol
shims can remain registered and return feature-disabled errors. The native
`get_runtime_capabilities` DTO reports the individual database/protocol features;
the frontend hides unavailable options and applies the same requirement to
persisted-session launch. The source parity regression requires every feature
used by that DTO to be forwarded from the application to the core crate.

All 27 integration descriptors are covered by the frontend requirement matrix.
KeePass is always available; Exchange requires cloud, Ansible platform, Google
Drive collab-or-platform, SQL Server MSSQL, and the remaining 22 integrations ops.
Built-in iDRAC/iLO/Lenovo/Supermicro/VoIP management also requires ops.

Docker commands belong to platform. Their concrete `DockerServiceState` is now
registered by the shared startup registrar when either ops or platform is
enabled, rather than only by the ops registrar. A real Tauri mock-app test checks
the exact command state type and idempotent registration under platform alone.
This closes a state omission masked by full builds; it does not make the currently
unreferenced Docker panel a supported connection integration.

## What no frontend reference means

The report calls these names `nativeOnlyReview`, not “dead” or “missing buttons.”
Review must distinguish:

- Infrastructure/internal commands: lifecycle, stream/event channels, recovery,
  diagnostics and compatibility entry points may intentionally have no ordinary
  button or be used by another native surface.
- Compatibility paths: native recording commands are largely separate from the
  frontend's current recording/macro storage path. The legacy recording migration
  entry point remains compatibility-only and now refuses explicit managed policy.
- Dormant frontend modules: DockerPanel/useDocker exist but are not imported by
  the current application route. Registering their state is necessary but not
  evidence of a completed Docker UI contract; argument and lifecycle work must
  precede exposing it.
- Genuine live gaps: the previous unfiltered Proxmox and MSSQL integration choices
  could reach unavailable native operations in lean. Capability filtering and
  launch guards address those paths without presenting disabled integrations.
- Unclassified native-only names: the generated list remains an explicit review
  queue. No blanket claim of UI use or safe removal is made for those names.

## Dynamic calls and limits

The checker resolves constants/imports, local lexical conditional values, finite
literal unions, string templates/concatenation, object lookups, and finite calls
to named local/imported invoke wrappers. Proxmox VM/container actions have explicit
supported unions, so all composed command names are checked.

Twenty-three open-ended invoke declarations currently remain across twenty unique
file/expression pairs. They are forwarding wrappers, injectable RDP runtime
interfaces and BMC/cloud/session adapters; the test snapshots those boundaries so
new ones require review. Finite wrapper callers are checked independently. The
scanner does not execute code or guess arbitrary object identities, and does not
prove every possible string passed through an open public wrapper. Nor does it
validate IPC argument names, per-command managed state, authorization, network
success, or visible UI reachability. Those require focused runtime/consumer tests.
