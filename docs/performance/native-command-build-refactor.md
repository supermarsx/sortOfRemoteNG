---
title: Native command build refactor and measurement plan
description: Dev profile and command-boundary changes, preserved runtime features, and reproducible Cargo timing comparison instructions.
hide_page_header: true
---

# Native command build refactor and measurement plan

## Scope and evidence

This work preserves the full native feature defaults: `default = ["full"]` and `full-dev = ["full"]`. It does not turn development into a lean build, change security checks or impose a hard memory cap. Release optimization profiles remain unchanged. The managed development launcher's separate advisory job budget is documented in [Native build defaults](../native-build-features.md).

The command-boundary work is compiler/API isolation, not evidence that a huge nested tuple was the bottleneck. The prior core handler already boxed its implementation internally; its public opaque return type hid that existing box. Tauri 2.6.3 command registration emits dispatch match arms. Explicit boundary types and independently compiled command groups may improve incremental invalidation or parallelism, but their actual benefit must be measured. Root stack-reserve settings are unchanged.

## Development profile tradeoff

Ordinary non-workspace dependencies use `opt-level = 0` in dev. The fourteen existing core/RDP/YUV/OpenH264 runtime overrides remain at level 2. `tauri-macros`, `tauri-codegen`, `syn`, `quote` and `proc-macro2` explicitly retain level 1, because Cargo's wildcard package override takes precedence over its build-script override. The build override remains level 2 for applicable workspace build-time code.

The six SQLx package overrides use four codegen units and optimization level 0; rustls uses four units while retaining level 1. Windows binding packages retain one unit and level 1. Debug info remains disabled and incremental compilation stays enabled. More codegen units can expose LLVM parallelism, not parallelize type checking or enforce a RAM limit. Other dev runtime paths may run slower when their dependencies are unoptimized. Cargo tests normally inherit dev profile settings. These are deliberate compilation/runtime tradeoffs, not an established speedup. See [Cargo profile overrides](https://doc.rust-lang.org/cargo/reference/profiles.html#overrides).

## Command registrar layout

The application's invoke handler (`src-tauri/src/invoke_handler.rs`) asks each top-level command crate `is_command` in a fixed order and dispatches to the first crate that recognizes the command. Splitting a crate changes where its commands are compiled, not which commands are registered. A name-and-`#[cfg]` comparison of the infrastructure and VPN moves against the pre-split revision found 7,959 registered names on both sides, none missing or added and no per-entry feature-gate difference. The same comparison for the operations split again found 7,959 names on both sides with none missing or added. Its only gate differences are the 39 Kafka entries, which moved from a gate on their whole handler group to the same `feature = "kafka"` gate on each entry.

### Bounded generated registrars

A bounded registrar is a crate that owns at most 250 commands. Its `commands.json` (version 1) lists each command as a `module::command` path, with an optional `cfg` string for a feature-gated entry. `scripts/generate-command-inventory.mjs` renders `src/handler.rs` from that manifest: a sorted `COMMAND_NAMES` array, `is_command` as a binary search over it, one `tauri::generate_handler!` call and a unit test for order, uniqueness and the bound. The generator rejects empty or oversized inventories, duplicate names, unknown fields and malformed paths. Edit `commands.json` and regenerate; do not edit `handler.rs` by hand. `node scripts/generate-command-inventory.mjs --check` fails on a stale handler and runs in the CI `version` job.

The crate root aliases its domain crates (for example `pub use sorng_idrac as idrac;`), so managed-state types are the same `TypeId`s that application startup registers. It exports `COMMAND_NAMES`, `is_command` and `build() -> Handler`, where `Handler` is a boxed `InvokeHandler`; the generated closure type stays inside the owning crate. In the infrastructure and operations children, `src/<module>_commands.rs` re-exports the domain `service` and `types` modules and declares `mod inner;`, and `src/<module>_commands/inner.rs` holds the `#[tauri::command]` bodies moved out of the domain crate. The VPN crate keeps its bodies directly in `src/<module>_commands.rs`. No bounded registrar uses `include!` or `#[path]` for command bodies.

### Facades and parents

`sorng-commands-infra` is now a compatibility facade. It owns no command wrappers; it re-exports the child module aliases, ORs the children's `is_command` and routes each invocation to the first child that recognizes it. Its test asserts that the child inventories are disjoint, each within the bound, and completely routed (683 commands).

`sorng-commands-ops` is a facade of the same shape over nine children. Its test expects 1,773 commands with the `kafka` feature and 1,734 without it.

`sorng-commands-core` is not generated. Its ten `define_command_group!` lists (1,028 entries, largest 153) are hand-maintained, and each group's `is_command` is a binary search over its list, so an unsorted edit would silently mis-route. `scripts/sort-core-command-groups.mjs` rewrites the lists in canonical order; its `--check` runs in the CI `version` job, and the core unit test `generated_command_groups_are_unique_recognized_and_exactly_routed` also checks ordering and routing. VPN commands moved out of core into the generated child `sorng-commands-vpn`. Core depends on it unconditionally and routes to it before its own groups, so VPN commands remain in every build. The eight SoftEther entries keep their `vpn-softether` gate, and core's `vpn-softether` feature forwards to the child.

| Crate                           | Role                     | Domains                                                                                                                   | Commands |
| ------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------: |
| `sorng-commands-infra`          | facade                   | the five children below                                                                                                   |      683 |
| `sorng-commands-bmc`            | generated child of infra | iDRAC, iLO, Lenovo XClarity, Supermicro                                                                                   |      241 |
| `sorng-commands-virtualization` | generated child of infra | Hyper-V, VMware                                                                                                           |      143 |
| `sorng-commands-proxmox`        | generated child of infra | Proxmox VE                                                                                                                |      123 |
| `sorng-commands-nas`            | generated child of infra | Synology                                                                                                                  |      119 |
| `sorng-commands-remote`         | generated child of infra | MeshCentral (dedicated), VoIP phone                                                                                       |       57 |
| `sorng-commands-vpn`            | generated child of core  | OpenVPN (including dedicated), WireGuard, IKEv2, IPsec, L2TP, PPTP, SSTP, SoftEther, Tailscale, ZeroTier, proxy, chaining |      146 |
| `sorng-commands-ops`            | facade                   | the nine children in the operations table below                                                                           |    1,773 |

The access, cloud, collab, mail, platform, services, sessions, tools and webservers command crates keep their existing hand-written handlers and are unchanged by this layout. The mail, services, tools and webservers crates still include their command modules by `#[path]` from files in `sorng-commands-ops/src/`. The ops facade does not compile those files itself.

On Windows MSVC, a registrar whose unit tests use Tauri's mock runtime (the tauri `test` feature) needs a `build.rs` that embeds a Common Controls v6 manifest dependency. Test executables do not receive the application's manifest, and without one Windows stops them with `STATUS_ENTRYPOINT_NOT_FOUND` before any test runs. `sorng-commands-nas` (Synology dispatch tests) and `sorng-commands-vpn` carry that `build.rs`. The infra and ops facades and the nine operations children have no mock-runtime tests and no `build.rs`.

### Operations registrar split

`sorng-commands-ops` used to be one direct registrar with 1,773 commands in 18 `generate_handler!` groups, the largest having 542 and 481 arms. It is now a facade over the nine bounded generated children below. The facade's only dependencies are the children and `tauri`. Its `is_command` and dispatch consult the children in the order their modules first appeared in the old groups. The inventories are disjoint, so that order does not change which child handles a command.

Kafka commands keep their `feature = "kafka"` gate. The app's `kafka`, `kafka-dynamic` and `kafka-static` features enable `sorng-commands-ops?/kafka`, and the facade forwards that to `sorng-commands-ops-messaging/kafka`, which enables the optional `sorng-kafka` dependency. `sorng-kafka` stays at `default-features = false`, so the app feature still selects how librdkafka is linked. A standalone Kafka check must name a linking mode, for example `cargo check -p sorng-commands-ops -p sorng-kafka --features sorng-commands-ops/kafka,sorng-kafka/cmake-build` through `scripts/native-build-env.mjs`.

| Crate                              | Modules (commands)                                                              | Total |
| ---------------------------------- | ------------------------------------------------------------------------------- | ----: |
| `sorng-commands-ops-system`        | bootloader 43, cron 39, kernel_mgmt 41, os_detect 43, proc_mgmt 32, time_ntp 27 |   225 |
| `sorng-commands-ops-identity`      | pam 34, freeipa 47, hashicorp_vault 54, mac_mgmt 43                             |   178 |
| `sorng-commands-ops-network`       | pfsense 99, draytek 6, port_knock 54, fail2ban 44                               |   203 |
| `sorng-commands-ops-web`           | cpanel 87, php_mgmt 91                                                          |   178 |
| `sorng-commands-ops-databases`     | mysql_admin 101, pg_admin 97                                                    |   198 |
| `sorng-commands-ops-platform`      | netbox 143, cups 52, about 14, remote_backup 13                                 |   222 |
| `sorng-commands-ops-monitoring`    | grafana 46, prometheus 22, zabbix 53, ups_mgmt 70, ipmi 41                      |   232 |
| `sorng-commands-ops-orchestration` | compose 52, cicd 57, etcd 42, consul 32, ceph 57                                |   240 |
| `sorng-commands-ops-messaging`     | rabbitmq 58, kafka 39 (behind `kafka`)                                          |    97 |

## Record comparable builds

Use isolated source snapshots and target directories; never clean or overwrite the user's active target directory. Record source revision, feature set, native staging mode, target triple, Rust toolchain, job count, physical available memory and exact command. Keep these inputs identical between before/after cases except the change being measured. Retain the process exit status and external wall-clock timestamps separately from Cargo's HTML.

Distinguish a fresh-target build from an unchanged-source warm rebuild and a controlled small-source edit. Record the edit and restore it exactly before the next case. Do not compare one cold build against one warm build. Background compilation, staging overhead and filesystem cache differences must be disclosed. An interrupted build or an old timing file is not a successful benchmark result.

Add `--timings` to the existing full-feature Cargo command selected for the experiment. Cargo writes a dated report under the chosen target directory's `cargo-timings` directory; retain that dated file with its command and outcome instead of relying on the overwritten `cargo-timing.html` alias.

## Summarize the retained timing data

```sh
node scripts/ci/summarize-native-build-timings.mjs BEFORE.html
node scripts/ci/summarize-native-build-timings.mjs BEFORE.html AFTER.html
node scripts/ci/summarize-native-build-timings.mjs --json BEFORE.html AFTER.html
```

This read-only tool parses the embedded `UNIT_DATA` JSON without executing HTML or JavaScript. It understands the current frontend/codegen section intervals, preserves missing timings as `null`, and identifies ambiguous repeated unit identities instead of guessing matches. JSON output includes input hashes and per-unit comparisons. It does not start Cargo, alter environment variables or write reports; redirect output yourself if you want an artifact.

`DURATION` is the plotting extent, which may be rounded above the latest recorded unit end. Neither number is command wall time. Unit durations overlap and must not be summed as wall time; the codegen phase is not a standalone linker measurement. A zero-duration record does not establish a no-op. Report completion, cache state and cold/incremental classification always need the external command evidence. Confirm linker-only timing through a separate observer if that distinction matters.

## Measurements

Before/after results for the registrar split and their verification status are pending. No speed or memory reduction is claimed by these configuration and parser tests alone.

### Baseline evidence

These are the observations that motivated the split, not results of it. They come from one cold full-feature `dev` build of each of two revisions, each in its own source snapshot and fresh target directory: `before` at `3d645bd8` and `boxed` at `65140e2b`. `65140e2b` differs from the revision this split started from only in tooling files. The dated Cargo HTML reports and console logs are local, untracked artifacts under `.cache/` and were summarized with `scripts/ci/summarize-native-build-timings.mjs`. Each case ran once. The exact command line, job count, available memory and process exit status were not retained with them; each log ends in Cargo's `Finished` line (6 m 49 s and 4 m 39 s), which suggests the builds completed but is not an external wall-clock record. Native staging state differed: the `before` log reports a metadata-only OPKSSH vendor wrapper with no staged bridge, while the `boxed` log does not.

Seconds below are Cargo plot positions and unit phases. Units overlap and must not be summed.

| Unit                   | `before` frontend | `before` end | `boxed` frontend | `boxed` end |
| ---------------------- | ----------------: | -----------: | ---------------: | ----------: |
| `sorng-commands-ops`   |            104.56 |       301.11 |           110.94 |      257.43 |
| `sorng-commands-core`  |             64.69 |       279.16 |            67.91 |      218.31 |
| `sorng-commands-infra` |             64.06 |       255.61 |            75.97 |      199.72 |
| `sorng-commands-mail`  |             54.00 |       242.97 |            59.96 |      192.70 |
| `sorng-commands-cloud` |             47.62 |       252.02 |            53.59 |      196.01 |
| `app` library          |             69.84 |       390.17 |            11.03 |      257.66 |
| `app` binary           |                 — |       409.54 |                — |      279.57 |

In `boxed`, `sorng-commands-ops` has the longest frontend of any unit. It is the only unit to end between core (218.31 s) and the app library (257.66 s). The [10 September timings](build-timings-2026-09-10.md) show the same late chain through commands-ops, with a 111.34 s frontend. The infra facade's 75.97 s frontend is the unit the infrastructure split replaces with five smaller children. Other hand-written command crates range from 24.14 s (tools) to 67.91 s (core) in `boxed`.

The two revisions differ by two commits: `ccbfc1af` erases handler types at command crate boundaries and `65140e2b` changes development codegen settings. The app library frontend drop from 69.84 s to 11.03 s is consistent with the handler erasure, and the plot extent fell from 410 s to 280 s. These single runs cannot attribute either difference to one commit.

Not measured: what the infrastructure or operations split changes. Even if the nine operations children compile in parallel and all finish before core, the app library would still wait for core, so this cold tail could shrink by at most the gap between the operations and core end times, about 39 s of 280 s. An edit in one operations domain would recompile a child of at most 250 commands, the facade and the app instead of the 1,773-command registrar; domain crates that fan out to other dependents would still rebuild those. Both expectations need comparable after measurements.
