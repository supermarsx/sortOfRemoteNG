# ARCHITECTURE

`sortOfRemoteNG` (sorng) is a Tauri 2 desktop application whose frontend is a
Next.js / React 19 app (TypeScript, Tailwind) and whose backend is a Rust
workspace of ~200 purpose-scoped crates under `src-tauri/crates/`. The app is a
spiritual successor to mRemoteNG focused on polyglot protocol coverage
(SSH / RDP / VNC / SFTP / SMB / serial / RustDesk / VPN / BMC / cloud consoles),
credential management, session recording, and optional AI assistance.

This document describes the layout, how the frontend reaches Rust services,
the threading model, the feature-flag surface, the command-handler aggregation
pattern, and a feature-parity matrix vs. mRemoteNG and Royal TS.

---

## 1. Workspace layout

```
repo root
├── src/                         Next.js + React frontend (TypeScript)
│   ├── hooks/                   React hooks that wrap Tauri invoke()
│   ├── components/              UI components
│   └── types/                   TS types mirrored from Rust serde structs
├── src-tauri/                   Tauri host + Rust workspace root
│   ├── src/                     Binary crate: main.rs, lib.rs, handler registry
│   ├── Cargo.toml               Workspace manifest (members + features)
│   └── crates/                  ~200 service / protocol / domain crates
├── e2e/                         Playwright end-to-end suite
├── tests/                       vitest unit tests
└── docs/                        design docs, plans, runbooks
```

### 1.1 Crate families

The workspace is decomposed by _responsibility_, not by protocol. The major
families are:

| Family                  | Representative crates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Purpose                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Foundation**          | `sorng-core`, `sorng-auth`, `sorng-storage`, `sorng-network`, `sorng-credentials`, `sorng-vault`, `sorng-biometrics`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Shared types, error, config, crypto, secret storage, OS credential backends.                                                                                                                       |
| **Protocols**           | `sorng-ssh`, `sorng-rdp`, `sorng-rdp-vendor`, `sorng-vnc`, `sorng-sftp`, `sorng-scp`, `sorng-ftp`, `sorng-telnet`, `sorng-serial`, `sorng-spice`, `sorng-x2go`, `sorng-xdmcp`, `sorng-nx`, `sorng-rustdesk`, `sorng-protocols`                                                                                                                                                                                                                                                                                                                                                                       | Wire/session drivers. `rdp-vendor` is the rlib-only boundary around the heavy IronRDP/openh264 graph. `sorng-protocols` is the thin dynamic-dispatch registry shared by `-dynamic` feature builds. |
| **VPN / Overlay**       | `sorng-vpn`, `sorng-openvpn`, `sorng-wireguard`, `sorng-tailscale`, `sorng-zerotier`, `sorng-netbird`, `sorng-teleport`, `sorng-warpgate`, `sorng-gateway`, `sorng-p2p`                                                                                                                                                                                                                                                                                                                                                                                                                              | SoftEther/OpenVPN/WG dataplanes, overlay-network control, jump-host gateway.                                                                                                                       |
| **Remote mgmt / BMC**   | `sorng-remote-mgmt`, `sorng-ard`, `sorng-ipmi`, `sorng-idrac`, `sorng-ilo`, `sorng-supermicro`, `sorng-lenovo`, `sorng-bmc-common`, `sorng-meshcentral`, `sorng-termserv`                                                                                                                                                                                                                                                                                                                                                                                                                            | Out-of-band and cross-vendor console/KVM support.                                                                                                                                                  |
| **Cloud**               | `sorng-cloud`, `sorng-aws`, `sorng-aws-vendor`, `sorng-azure`, `sorng-gcp`, `sorng-oracle-cloud`, `sorng-hetzner`, `sorng-proxmox`, `sorng-vmware`, `sorng-vmware-desktop`, `sorng-hyperv`, `sorng-lxd`, `sorng-k8s`, `sorng-docker`, `sorng-docker-compose`, `sorng-synology`                                                                                                                                                                                                                                                                                                                       | Control-plane SDK shims + file-share/VM lifecycle.                                                                                                                                                 |
| **Collab / Files**      | `sorng-collaboration`, `sorng-dropbox`, `sorng-gdrive`, `sorng-onedrive`, `sorng-nextcloud`, `sorng-whatsapp`, `sorng-telegram`, `sorng-jira`, `sorng-osticket`, `sorng-filesharing`                                                                                                                                                                                                                                                                                                                                                                                                                 | Shared sessions, chat bridges, ticketing, cloud-file sync.                                                                                                                                         |
| **Security / Secrets**  | `sorng-1password`, `sorng-bitwarden`, `sorng-keepass`, `sorng-lastpass`, `sorng-dashlane`, `sorng-google-passwords`, `sorng-hashicorp-vault`, `sorng-vault-windows`, `sorng-passbolt`, `sorng-totp`, `sorng-yubikey`, `sorng-gpg-agent`, `sorng-ssh-agent`, `sorng-secure-clip`, `sorng-port-knock`, `sorng-opkssh`, `sorng-freeipa`, `sorng-ldap`, `sorng-pam`                                                                                                                                                                                                                                      | Vault integrations, MFA, agent forwarding, clipboard hygiene.                                                                                                                                      |
| **Databases**           | `sorng-mysql`, `sorng-mysql-admin`, `sorng-postgres`, `sorng-postgres-admin`, `sorng-mssql`, `sorng-sqlite`, `sorng-mongodb`, `sorng-redis`, `sorng-etcd`, `sorng-consul`                                                                                                                                                                                                                                                                                                                                                                                                                            | Database browsers and administration; saved PostgreSQL tabs use isolated direct native sessions.                                                                                                   |
| **Ops / Infra**         | `sorng-ansible`, `sorng-terraform`, `sorng-cicd`, `sorng-packages`, `sorng-systemd`, `sorng-cron`, `sorng-fail2ban`, `sorng-letsencrypt`, `sorng-prometheus`, `sorng-grafana`, `sorng-zabbix`, `sorng-netbox`, `sorng-snmp`, `sorng-syslog`, `sorng-kafka`, `sorng-rabbitmq`, `sorng-ceph`, `sorng-nginx`, `sorng-nginx-proxy-mgr`, `sorng-caddy`, `sorng-traefik`, `sorng-apache`, `sorng-haproxy`, `sorng-pfsense`, `sorng-dhcp`, `sorng-dns`, `sorng-ddns`, `sorng-time-ntp`, `sorng-bootloader`, `sorng-kernel`, `sorng-diskmgmt`, `sorng-backup-verify`, `sorng-remote-backup`, `sorng-storage` | Infrastructure automation bound to CLI/SSH/API.                                                                                                                                                    |
| **Mail**                | `sorng-postfix`, `sorng-dovecot`, `sorng-mailcow`, `sorng-amavis`, `sorng-rspamd`, `sorng-spamassassin`, `sorng-clamav`, `sorng-opendkim`, `sorng-cyrus-sasl`, `sorng-procmail`, `sorng-roundcube`, `sorng-exchange`, `sorng-smtp`                                                                                                                                                                                                                                                                                                                                                                   | Mail-server admin and exchange/mailbox bridges.                                                                                                                                                    |
| **Web hosting / CMS**   | `sorng-cpanel`, `sorng-php`, `sorng-budibase`, `sorng-marketplace`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Hosting-panel and app-builder integrations.                                                                                                                                                        |
| **Platform / Shell**    | `sorng-app-shell`, `sorng-app-auth`, `sorng-app-domains*`, `sorng-command-palette`, `sorng-extensions`, `sorng-i18n`, `sorng-fonts`, `sorng-terminal-themes`, `sorng-updater`, `sorng-portable`, `sorng-about`, `sorng-rdpfile`, `sorng-mremoteng`, `sorng-mac`, `sorng-winmgmt`, `sorng-powershell`                                                                                                                                                                                                                                                                                                 | Shell chrome, window/session UI glue, importers, platform shims.                                                                                                                                   |
| **Observability**       | `sorng-recording`, `sorng-replay`, `sorng-topology`, `sorng-dashboard`, `sorng-notifications`, `sorng-filters`, `sorng-hooks`, `sorng-scheduler`                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Session recording/replay, live dashboards, structured event hooks (tracing integration).                                                                                                           |
| **AI / Automation**     | `sorng-ai-agent`, `sorng-ai-assist`, `sorng-llm`, `sorng-mcp`, `sorng-ssh-scripts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | LLM client, MCP server/client, agentic SSH runbooks.                                                                                                                                               |
| **Command aggregators** | `sorng-commands-core`, `sorng-commands-ops`, `sorng-commands-cloud`, `sorng-commands-collab`, `sorng-commands-platform`, `sorng-commands-access`, `sorng-commands-infra`, `sorng-commands-mail`, `sorng-commands-services`, `sorng-commands-sessions`, `sorng-commands-tools`, `sorng-commands-webservers`                                                                                                                                                                                                                                                                                           | See §5: the `#[tauri::command]` surface.                                                                                                                                                           |
| **Domain glue**         | `sorng-app-domains` (+ `-core`, `-ops`, `-cloud`, `-collab`, `-platform`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Feature-gated façade that re-exports services into the binary.                                                                                                                                     |

### 1.2 Crate-graph sketch

```
                   ┌───────────────────────────┐
 React/Next (src/) │  src-tauri (binary crate) │
   hooks  ─invoke▶ │  lib.rs + handler regs    │
                   └──────────────┬────────────┘
                                  │ Tauri managed state
                                  ▼
                       ┌───────────────────────┐
                       │ sorng-commands-*      │  family aggregators
                       │  core / ops / cloud / │  (#[tauri::command] fns)
                       │  collab / platform …  │
                       └──────────┬────────────┘
                                  │ calls service
                                  ▼
                       ┌───────────────────────┐
                       │ sorng-app-domains*    │  feature-gated re-export
                       │  (ops/cloud/collab…)  │
                       └──────────┬────────────┘
                                  ▼
            ┌────────────┬────────────┬────────────┬───────────┐
            │ protocol   │ cloud      │ security   │ observ.   │
            │ (ssh/rdp…) │ (aws/gcp…) │ (vault…)   │ (rec/hook)│
            └─────┬──────┴─────┬──────┴─────┬──────┴─────┬─────┘
                  ▼            ▼            ▼            ▼
                           sorng-core  (errors, types, config, tracing)
```

---

## 2. Tauri invoke pattern

The frontend and backend communicate through Tauri 2's `invoke` bridge. A
concrete round-trip looks like:

1. **Frontend hook** (`src/hooks/ssh/useSshConnection.ts` etc.) calls
   `invoke<ReturnT>("ssh_connect", { args })`.
2. Tauri IPC routes the call to the `#[tauri::command]` function registered
   with that name. Handlers live in `src-tauri/crates/sorng-commands-*/src/
*_commands.rs` and are aggregated via per-family `*_handler.rs` (see §5).
3. The command extracts **managed state** (`State<'_, Arc<FooService>>`) that
   was registered in `src-tauri/src/lib.rs` / `main.rs` at `App::manage(...)`.
4. The command calls into the service crate (`sorng-ssh`, `sorng-rdp`, …),
   which performs the I/O and returns a `Result<T, sorng_core::Error>`.
5. The return type is `serde::Serialize`; the TS generic on `invoke<T>` must
   mirror the Rust struct. `src/types/` holds the hand-maintained mirror
   (kept in sync with the serde shape — no `ts-rs` generation yet).

**Rules of thumb (enforced by clippy + code review):**

- Command functions are `async fn` and must be `Send`.
- Commands **never** own long-running work; they dispatch to a service that
  returns immediately, usually issuing a Tokio task or session handle.
- Commands **never** hold a blocking lock across an `.await`.
- Errors are mapped to a string or a tagged enum via `serde` before crossing
  the IPC boundary (Tauri only transports `Serialize` payloads).

---

## 3. Frontend / backend split

| Layer            | Path                                                                                                                            | Responsibility                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| UI components    | `src/components/**`, `app/**` (Next app router)                                                                                 | Pure presentation.                                                                                              |
| Hooks            | `src/hooks/**` (ssh, rdp, session, connection, synology, proxmox, recording, scheduler, security, sync, network, monitoring, …) | Wrap `invoke()`; convert Tauri `listen`/`emit` events into React state.                                         |
| TS types         | `src/types/**` + per-hook local types                                                                                           | Mirror Rust serde. When a Rust struct changes you must update the TS type — CI type-checks with `tsc --noEmit`. |
| IPC bridge       | Tauri 2 runtime                                                                                                                 | `invoke`, `emit`, `listen`; capability allowlist in `src-tauri/tauri.conf.json`.                                |
| Command handlers | `sorng-commands-*`                                                                                                              | Thin; validate input, fetch `State<_>`, call service.                                                           |
| Services         | family crates (`sorng-ssh`, `sorng-aws`, …)                                                                                     | Own sockets, sessions, background tasks, caches.                                                                |
| Foundation       | `sorng-core`, `sorng-auth`, `sorng-storage`, `sorng-credentials`                                                                | Shared types, persistence, secrets.                                                                             |

Background events (progress, log lines, session frames, recording status) flow
backend → frontend via `app_handle.emit("channel", payload)`. Hooks attach
listeners and dispose of them on unmount. Channel names are namespaced per
feature (e.g. `ssh:session:<id>:stderr`, `rdp:frame:<id>`, `vpn:state`).

---

## 4. Threading model

The backend uses **Tokio multi-thread runtime** (default flavor, `rt-multi-thread`).

**Invariants:**

1. The **Tauri command thread must never block.** Every `#[tauri::command]`
   function returns within milliseconds; long work is moved to a Tokio task.
2. **I/O-bound work** (network sockets, TLS, async DB drivers, async SSH)
   runs on the shared Tokio runtime via `tokio::spawn`.
3. **CPU-bound or sync-FFI work** (ssh2's libssh2 FFI, IronRDP bitmap decode,
   openh264 frame decode, openssl calls, serial-port reads, native file I/O)
   runs on `tokio::task::spawn_blocking` so it cannot starve the async
   reactor. The SSH session in `sorng-ssh` is a canonical example: a
   blocking `ssh2::Session` lives on a `spawn_blocking` worker and
   communicates with async callers via `tokio::sync::mpsc`.
4. **Inter-task messaging** uses `tokio::sync::mpsc` (for streams like stdout
   lines, RDP frame buffers, session events), `tokio::sync::oneshot`
   (for request/response), `tokio::sync::watch` (for state snapshots like
   VPN connection state), and `tokio::sync::broadcast` (for fan-out such as
   session-recording subscribers).
5. **Shared mutable state** is an `Arc<Mutex<…>>` only when the held
   critical section is synchronous and short; otherwise `Arc<RwLock<…>>`
   or an **actor** pattern (owned by a task, messages via mpsc) is used.
6. **Cancellation** uses `tokio_util::sync::CancellationToken` so parent
   scopes can stop a graph of child tasks deterministically.

**Per-session actor pattern** (SSH, RDP, serial, VPN):

```
  #[tauri::command] ──▶ SessionMgr.spawn() ──▶ session actor task
                                                 │  owns socket + FFI
                                                 ▼
                                        (mpsc rx) cmd in
                                        (mpsc tx) event out ─▶ app.emit()
```

Tracing (e23) wraps task spawns with `tracing::instrument` spans so every
background task carries a session/correlation id through the log pipeline.
Structured JSON logs are enabled via the `logs-json` build/runtime toggle.

---

## 5. Command-handler aggregation

The binary crate registers `tauri::generate_handler![...]` with a single flat
list. To avoid a 1000-line macro in `main.rs`, the workspace is split into
**family aggregators**:

| Family crate                                                                                        | Handler entry point                                                | Gated by feature                                                                                                                        |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `sorng-commands-core`                                                                               | `core_handler::handler()`                                          | always on; `lean` keeps the core/serial surface plus legacy AWS/Vercel/Cloudflare glue until that slice moves to `sorng-commands-cloud` |
| `sorng-commands-ops`                                                                                | `ops_handler`, `infra_handler`, `mail_handler`, `services_handler` | `ops`                                                                                                                                   |
| `sorng-commands-cloud`                                                                              | `cloud_handler::handler()`                                         | `cloud`                                                                                                                                 |
| `sorng-commands-collab`                                                                             | `collab_handler::handler()`                                        | `collab`                                                                                                                                |
| `sorng-commands-platform`                                                                           | `platform_handler::handler()`                                      | `platform`                                                                                                                              |
| `sorng-commands-access` / `-infra` / `-mail` / `-services` / `-sessions` / `-tools` / `-webservers` | one `*_handler.rs` per crate                                       | folded into `ops` or `core`                                                                                                             |

Inside each aggregator the convention is:

```
src/
├── lib.rs                     # re-exports handler() + each *_commands module
├── <family>_handler.rs        # pub fn handler(b: Builder) -> Builder
└── <topic>_commands.rs        # #[tauri::command] async fn ... (one file per topic)
```

`<family>_handler.rs` calls `b.invoke_handler(tauri::generate_handler![ ... ])`
for the union of its topics; `src-tauri/src/lib.rs` chains every enabled
family's `handler()` into the builder. Disabled families compile to nothing.

### 5.1 Connection Clone & Bulk Reachability Check

Clone duplicates an existing connection with a new id. By default, credentials
and other sensitive fields (`password`, `privateKey`, `passphrase`,
`totpSecret`, `basicAuthPassword`, `rustdeskPassword`, plus nested secrets
inside `cloudProvider` / `gatewaySettings` / `gateway` / `proxyConfig`
— `password`, `apiKey`, `accessToken`, `clientSecret`, `privateKey`,
`passphrase`, `proxyPassword` — and `totpConfigs`) are stripped; an explicit
`include_credentials` flag on the `clone_connection` command opts into
preserving them. Every clone call emits a
`tracing::info!(target = "audit", action = "connection.clone", …)` event
recording the source id, new id, and whether credentials were included.

Bulk reachability check (`check_all_connections`) probes a batch of
connections concurrently (default cap 8 via `tokio::sync::Semaphore`), with
per-protocol probes implemented in the `sorng-probes` crate:

- **TCP**: `tcp_probe` — plain connect with timeout.
- **SSH**: `ssh_probe` — connect + banner read.
- **RDP**: `rdp_probe` — connect + X.224 negotiation parse (reports
  `nla_required` / `negotiated_protocol`).

Progress streams over `connection-check-progress` events (per connection) and
terminates with `connection-check-complete`. The run is cancellable via
`cancel_check_run` backed by a `tokio_util::sync::CancellationToken`. Probes
never send credentials; they only test reachability and capability metadata.

---

## 6. Feature-flag reference

Flags are declared on the root binary crate in `src-tauri/Cargo.toml` and
propagate down through `sorng-app-domains` → family/service crates.

### 6.1 Top-level features (`src-tauri/Cargo.toml`)

| Flag                                                                  | Default | Purpose                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | :-----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lean`                                                                |   yes   | Developer default. Keeps the always-on command crates and dynamic serial wiring while leaving the large ops/collab/platform/RDP/database feature families out unless explicitly requested. Legacy AWS/Vercel/Cloudflare REST and Tauri glue still keeps the cloud domain loaded until that slice moves out of `sorng-commands-core`. |
| `ops`                                                                 |   no    | Enable ops family: `sorng-app-domains/ops` + `sorng-commands-ops` + `-infra` + `-mail` + `-services` + `-tools` + `-webservers`.                                                                                                                                                                                                     |
| `cloud`                                                               |   no    | Enable cloud family: `sorng-app-domains/cloud` + `sorng-commands-cloud`.                                                                                                                                                                                                                                                             |
| `collab`                                                              |   no    | Collaboration / file-sync: `sorng-app-domains/collab` + `sorng-commands-collab`.                                                                                                                                                                                                                                                     |
| `platform`                                                            |   no    | Platform-shell extras: `sorng-app-domains/platform` + `sorng-commands-platform`.                                                                                                                                                                                                                                                     |
| `rdp`                                                                 |   no    | RDP client surface (`sorng-app-domains/rdp`, `sorng-commands-core/rdp`).                                                                                                                                                                                                                                                             |
| `rdp-software-decode`                                                 |   no¹   | Enable Cisco openh264 software H.264 decode in `sorng-rdp-vendor`.                                                                                                                                                                                                                                                                   |
| `rdp-mf-decode`                                                       |   no¹   | Enable Windows Media Foundation hardware H.264 decode (Windows-only).                                                                                                                                                                                                                                                                |
| `rdp-snapshot`                                                        |   no¹   | PNG snapshot encoding for `rdp_get_frame_data`.                                                                                                                                                                                                                                                                                      |
| `cert-auth`                                                           |   no    | SSH/RDP certificate-based auth flows.                                                                                                                                                                                                                                                                                                |
| `db-mongo` / `-mssql` / `-mysql` / `-postgres` / `-redis` / `-sqlite` |   no²   | Per-database driver gates (link-time opt-in).                                                                                                                                                                                                                                                                                        |
| `kafka`                                                               |   no²   | `sorng-kafka` with system `librdkafka` dynamic linking (apt/dnf/pacman/brew/vcpkg/winget).                                                                                                                                                                                                                                           |
| `kafka-dynamic`                                                       |   no    | Alias of `kafka` retained for older CI/release invocations.                                                                                                                                                                                                                                                                          |
| `kafka-static`                                                        |   no    | Non-release static librdkafka-from-source path; keep out of production build aliases.                                                                                                                                                                                                                                                |
| `opkssh-vendored-wrapper`                                             |   no²   | Link the OPKSSH wrapper crate so release builds can stage and load the native wrapper artifact.                                                                                                                                                                                                                                      |
| `vpn-softether`                                                       |   no²   | SoftEther dataplane/control and Tauri command surface.                                                                                                                                                                                                                                                                               |
| `script-engine`                                                       |   no    | `sorng-ssh/script-engine` — embed rquickjs for SSH runbooks.                                                                                                                                                                                                                                                                         |
| `tls-cert-details`                                                    |   no    | Extended cert parsing in `sorng-protocols` via `x509-parser`.                                                                                                                                                                                                                                                                        |
| `logs-json`                                                           |   no²   | Emit structured JSON tracing lines for release log aggregation.                                                                                                                                                                                                                                                                      |
| `full`                                                                |    —    | Release/packaging alias enabling every shippable app-level feature above. It intentionally excludes non-release/test-only gates such as `kafka-static` and lower-crate `docker-e2e`. `npm run tauri:build`, Docker production builds, and the release workflow opt into this explicitly.                                             |

¹ Enabled by default inside `sorng-rdp` itself; the app-level flag lets Tauri
builds opt-in/out.
² Always in `full`.

### 6.2 Planned / per-family feature flags used by deps

These are declared on lower crates and plumbed up by in-flight executors:

| Flag                                          | Defined in                         | Effect                                              |
| --------------------------------------------- | ---------------------------------- | --------------------------------------------------- |
| `protocol-serial` / `protocol-serial-dynamic` | `sorng-serial` + `sorng-protocols` | Static vs. dyn-dispatch serial driver registration. |

All flags are **additive** (Cargo convention): enabling one must never remove
functionality. `--all-features` is not the production shortcut because it also
pulls non-release or test-only gates such as `kafka-static`; use `full` for
shipping builds.

### 6.3 Runtime-equivalent toggles

Not every gate is a Cargo feature. Per-connection knobs (recording on/off,
DNS-over-HTTPS, proxy chaining, AI-assist, auto-reconnect backoff) are
configuration fields persisted in `sorng-storage` and read through
`sorng-core::Config`.

---

## 7. Feature-parity matrix

Legend: ● full / ◐ partial / ○ scaffold, roadmap, or out-of-scope / — not applicable.

| Capability                                                                                               |                               sortOfRemoteNG                                |     mRemoteNG     |       Royal TS       |
| -------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------: | :---------------: | :------------------: |
| SSH (key + password + agent + cert)                                                                      |              ● `sorng-ssh` (ssh2 + agent fwd + script-engine)               |     ● (PuTTY)     |          ●           |
| RDP (GFX / RemoteFX / AVC)                                                                               |      ● `sorng-rdp` + `sorng-rdp-vendor` (IronRDP, MF/openh264 decode)       |  ● (mstsc shell)  |          ●           |
| VNC                                                                                                      |          ◐ WebSocket-capable endpoints only; no raw-TCP RFB bridge          |         ●         |          ●           |
| SFTP                                                                                                     |             ● native saved-session browser and file operations              |  ◐ (via WinSCP)   |          ●           |
| SCP                                                                                                      |  ● native saved-session browser; direct-route and explicit host trust only  |  ◐ (via WinSCP)   |          ●           |
| FTP / FTPS                                                                                               |     ● native saved-session browser; passive/EPSV and direct-route only      |         ◐         |          ●           |
| PostgreSQL                                                                                               |   ● isolated native query workbench with explicit SSL; direct-route only    |         ○         |          ●           |
| SMB file share                                                                                           |       ● `sorng-smb` (platform-native: Windows UNC / Unix `smbclient`)       |         ○         |          ●           |
| Telnet                                                                                                   |                        ● native interactive terminal                        |         ●         |          ●           |
| RLogin                                                                                                   |            ● RFC 1282 interactive terminal and native lifecycle             |         ●         |          ●           |
| Raw Socket                                                                                               |                    ● binary-safe TCP/UDP payload client                     |         ◐         |          ●           |
| PowerShell Remoting                                                                                      |                  ● persistent PSRP over WSMan/WinRM or SSH                  |         ◐         |          ●           |
| Apple Remote Desktop                                                                                     |     ● embedded ARD/RFB, with macOS Screen Sharing Apple Account handoff     |         ○         |          ●           |
| Serial console                                                                                           |          ● local native terminal, driver and permission dependent           |         ○         |          ●           |
| AnyDesk                                                                                                  |         ◐ installed native-client handoff; no embedded framebuffer          |         ○         |          ●           |
| RustDesk                                                                                                 |         ◐ installed native-client handoff; no embedded framebuffer          |         ○         |          ○           |
| SPICE                                                                                                    |      ◐ installed remote-viewer handoff; process status only, no embed       |         ○         |          ◐           |
| X2Go                                                                                                     |         ◐ installed x2goclient handoff; native auth and framebuffer         |         ○         |          ◐           |
| NX / NoMachine                                                                                           |          ◐ installed nxplayer handoff; native auth and framebuffer          |         ○         |          ◐           |
| XDMCP                                                                                                    |     ◐ installed local X server handoff; unauthenticated and unencrypted     |         ○         |          ◐           |
| VPN (OpenVPN / WireGuard / SoftEther / Tailscale / ZeroTier / Netbird / Teleport)                        |    ● `sorng-vpn` + siblings (SoftEther dataplane behind `vpn-softether`)    | ○ (external only) | ◐ (OpenVPN launcher) |
| Wake-on-LAN                                                                                              |                     ● `sorng-netutils` + `sorng-netmgr`                     |         ●         |          ●           |
| TOTP / MFA                                                                                               |                      ● `sorng-totp` + `sorng-yubikey`                       |         ○         |          ●           |
| Tabs + tiling / tear-off windows                                                                         |                             ● `sorng-app-shell`                             |         ●         |          ●           |
| Tagging + search                                                                                         |                ● `sorng-app-domains-core` + command palette                 |         ◐         |          ●           |
| Credential vault (1Password / Bitwarden / KeePass / LastPass / Dashlane / Google / HashiCorp / Passbolt) |                             ● per-vendor crates                             | ◐ (KeePass only)  |  ● (Bitwarden, 1P)   |
| OS credential store                                                                                      | ● `sorng-vault` + `sorng-vault-windows` (DPAPI / Keychain / Secret Service) | ● (Windows DPAPI) |          ●           |
| Session recording + replay                                                                               |                    ● `sorng-recording` + `sorng-replay`                     |         ○         |  ● (Secure Gateway)  |
| Scripting (SSH runbooks, JS)                                                                             |           ● `sorng-ssh-scripts` + rquickjs under `script-engine`            |         ○         |     ◐ (PS only)      |
| AI agent / MCP                                                                                           |       ● `sorng-ai-agent`, `sorng-ai-assist`, `sorng-llm`, `sorng-mcp`       |         ○         |          ○           |
| Session sharing / collab                                                                                 |                  ● `sorng-collaboration` (live co-session)                  |         ○         |          ◐           |
| BMC / IPMI / iDRAC / iLO / SuperMicro                                                                    |       ◐ dedicated command crates/hooks; not all have reachable panels       |         ○         |          ◐           |
| Cloud control planes (AWS / Azure / GCP / Proxmox / VMware / Hyper-V / LXD)                              |      ◐ per-vendor command crates; saved provider panels are not wired       |         ○         |          ◐           |
| Import from mRemoteNG                                                                                    |                    ● `sorng-mremoteng` + `sorng-rdpfile`                    |         —         |          ●           |
| Cross-platform (Win / macOS / Linux)                                                                     |                           ● Tauri 2 build matrix                            | ○ (Windows only)  |          ●           |
| Open source                                                                                              |                                      ●                                      |         ●         |          ○           |

The sortOfRemoteNG column reflects the current saved-session product boundary,
not merely the presence of a crate. Environment-dependent clients still need
their external target, driver, proxy, or installed application.

---

## 8. Further reading

- `docs/` — per-feature design docs and runbooks.
- `.orchestration/plans/` — active execution plans (t1–t3).
- `src-tauri/crates/sorng-core/src/tracing.rs` — tracing/log layer wiring.
- `src-tauri/src/lib.rs` — top-level Tauri builder and state registration.
- `readme.md` — user-facing build/run instructions.
