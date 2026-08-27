---
title: Proxmox VE integration
eyebrow: Use the app
description: Connect a saved Proxmox VE session with password, TFA, or API-token auth, trust a self-signed certificate on first use, open consoles and the web UI, and understand the current limits.
permalink: /integrations/proxmox/
---

## What it is

**Proxmox VE** is a saved connection type in the **Virtualization** group of
the protocol picker (`integration:proxmox`). Opening one mounts the Proxmox
management panel in a tab: cluster dashboard, nodes, QEMU VMs, LXC containers,
storage, network, tasks, snapshots, backups, firewall, pools, HA, Ceph and SDN
views, driven by the `sorng-proxmox` Rust crate over the PVE REST API
(`https://host:8006/api2/json`).

It is a management session, not a shell or framebuffer by itself. Consoles and
the web UI are separate actions described below. The registry-level support
statement lives in the [integration support matrix](../integrations.md); this
page is the operator guide.

## Connection setup

Create a connection, pick **Proxmox VE**, and fill the generic integration
fields. There is no Proxmox-specific editor section; the mapping is:

| Editor field    | Proxmox meaning                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hostname / port | The PVE node or cluster address. Default port `8006`. Any node of a cluster works; the panel enumerates the whole cluster through it.                                                     |
| Username        | Password mode: `user@realm` (for example `root@pam`, `ops@pve`). If the realm is omitted the panel's realm selector applies, defaulting to `pam`. API-token mode: `user@realm!tokenname`. |
| Password        | Password mode only. Stored in the OS vault, never in the connection file.                                                                                                                 |
| API key         | API-token mode only: the token **secret** (UUID). Stored in the OS vault. Leave the password empty.                                                                                       |
| Verify TLS      | On (default): the certificate must chain to a trusted CA. Off: the connection is only allowed with a pinned SHA-256 fingerprint, captured by the panel's certificate probe (see below).   |
| Timeout         | Per-request timeout in seconds (default 30).                                                                                                                                              |

The `!` in the username is what selects API-token mode; nothing else needs to
be toggled. The panel also exposes the same choices directly (auth mode,
realm, token id/secret, TLS skip, fingerprint) when the legacy stand-alone
panel is used.

### Realms

Proxmox authenticates a _principal_ `user@realm`. `pam` is the node's Linux
accounts, `pve` is the built-in Proxmox user database, and LDAP/AD/OpenID
realms use whatever id the administrator created. Precedence in the app:

1. an explicit `@realm` in the username,
2. the realm selected in the panel (`pam`, `pve`, or free text),
3. `pam`.

API tokens always carry their realm inside the token id, so the realm selector
does not apply to them.

### API tokens

Create the token in the PVE web UI under _Datacenter → Permissions → API
Tokens_. Two things to check:

- **Privilege Separation.** With it enabled (the default) the token has only
  the permissions explicitly granted to the token, not the user's. Grant at
  least `VM.Audit`/`Sys.Audit` on `/` for the dashboard to populate, plus
  `VM.PowerMgmt`, `VM.Console`, etc. for the actions you intend to use.
- **Console tickets.** `termproxy`/`vncproxy` require `VM.Console`
  (`Sys.Console` for a node shell). The app requests the ticket with the token
  header, then opens the console WebSocket with the same token.

Token sessions are verified against `GET /version` on connect. They never
expire on the client side and are never renewed (there is nothing to renew).

### Two-factor authentication (TFA)

Password logins on a TFA-protected account go through the PVE 7+ challenge
flow:

1. `POST /access/ticket` with username and password returns a challenge ticket
   (`PVE:!tfa!…`) and `NeedTFA: 1` instead of a session ticket.
2. The panel shows a **second-factor step**. Enter a TOTP code, a recovery
   key, or a Yubico OTP and submit; the app completes the challenge with
   `tfa-challenge=<challenge ticket>` and a `totp:`/`recovery:`/`yubico:`
   prefixed response. WebAuthn keys are not supported in-app; use an API token
   or a TOTP factor for that account instead.
3. Optionally store the account's **TOTP secret** (base32) as the
   `totpSecret` provider secret on the connection. The app then generates the
   code itself and completes the challenge without a prompt. The secret lives
   in the OS vault like the password.

PVE 6-style inline OTP (`otp` form field) is still accepted for older nodes.

Both flows are implemented against the documented PVE API and verified against
the in-repo mock server (see _Testing_ below); real-node verification of the
challenge details is still pending and reports are welcome.

### Ticket renewal

A PVE ticket is valid for two hours. The client renews a password session
automatically after 90 minutes, or immediately when a request returns `401`,
by re-posting `/access/ticket` with the current ticket as the password (no
second factor is needed for that). The failing request is retried once; a
second `401` surfaces as "session expired" and the panel offers reconnect. If
the renewal itself is rejected (hardened realm policy) the client falls back to
a full re-login with the stored password and, when configured, the stored TOTP
secret; interactive-TFA sessions without a stored secret ask you to reconnect.

## TLS trust (TOFU)

Verification is strict by default. Skipping verification is **only** allowed
together with a SHA-256 fingerprint pin and an explicit acknowledgement; the
crate refuses an unpinned `insecure` connection, so a stock self-signed PVE
certificate needs one extra step the first time:

1. Uncheck _Verify TLS_, then use **Fetch fingerprint** in the panel. The app
   performs a bare TLS handshake to the host, records the leaf certificate
   and closes the connection. No credentials are sent.
2. The prompt shows the fingerprint, subject, issuer, validity window and
   whether the certificate is self-signed. Compare the fingerprint with
   _Node → System → Certificates_ in the PVE web UI.
3. Accepting stores the fingerprint on the saved connection (`fields.fingerprint`)
   and connects. Every later connection to that instance is pinned to it; a
   changed certificate fails closed until you re-probe and accept again.

Renewing the PVE certificate (or moving to a CA-issued one and re-enabling
_Verify TLS_) is the normal way to clear a stale pin.

## Consoles

> **Status:** shipping in t67 phase 3. The terminal relay, noVNC bridge and
> their panel overlays are being built on top of the ticket commands that
> already exist; until they land the console buttons in the panel only fetch a
> ticket. This section describes the target behaviour.

The console actions on nodes, VMs and containers open an overlay inside the
Proxmox tab; they do not create a separate session tab.

- **Terminal (`termproxy`)** — an xterm.js terminal over a WebSocket relay in
  the Rust backend. The app requests a `termproxy` ticket, opens
  `…/vncwebsocket` with the same TLS policy and pin as the REST client, sends
  the `user:ticket` handshake and relays input, resize and keep-alive frames.
  Works for QEMU serial consoles, LXC containers and the node shell. Buffers
  are bounded (1 MiB per direction, up to 16 concurrent consoles).
- **noVNC (`vncproxy`)** — the app opens a loopback TCP→WSS bridge
  (`127.0.0.1:<random port>`, single client, 10 s accept timeout, idle timeout)
  and mounts the built-in native VNC client against it with the one-shot
  ticket as the VNC password. Plain RFB is allowed on that loopback socket
  only; TLS terminates in the WebSocket. Up to 8 bridges at a time; they close
  with the console or on disconnect.
- **SPICE** — the `spiceproxy` ticket command exists, but the app's SPICE
  handoff needs a `.vv` launcher path that is not wired for Proxmox yet.
  Use the terminal or noVNC console, or the web UI.

The terminal console is the primary path; the noVNC bridge is the later
phase and is the first thing to verify against a real node if a console
does not open.

## Open web UI

> **Status:** shipping in t67 phase 3 (panel adapter work).

**Open web UI** opens `https://host:port/` (deep-linked to the selected VM
when one is chosen) in an in-app HTTPS session with auto-login: the app fills
the PVE login window with the saved `user@realm` and password and submits.
Notes:

- Auto-login is **password mode only**. API-token connections open the web
  UI without filling anything (PVE's web UI does not accept API tokens).
- Accounts with TFA land on the PVE second-factor prompt; complete it there.
- The in-app viewer has its own certificate trust prompt, independent of the
  API pin.
- The session is ephemeral and not saved to the tree. **Open in external
  browser** is always available next to it.

## Known limits

- **One Proxmox host at a time.** The backend keeps a single process-global
  PVE client. Opening a second Proxmox connection while one is active is
  refused ("already connected in another tab"); the panel also offers
  **Take over** to disconnect the other tab and rebind. Multi-session
  support is a documented follow-up.
- Connections are direct only: proxy, VPN, SSH-hop and tunnel-chain routes
  are not applied to the PVE API client.
- WebAuthn as a second factor is not supported in-app.
- Cluster-wide views go through the node you connected to; if that node is
  down, reconnect to another member.
- The TFA challenge, termproxy framing and RFB-over-WebSocket details are
  verified against the repository's mock server, not against a live PVE
  release in CI.

## Testing

No live Proxmox node is part of the automated matrix; PVE is not
containerisable, so two mock servers stand in:

- **Rust:** `src-tauri/crates/sorng-proxmox/tests/mock_pve.rs` — an
  in-process TLS mock (`rcgen` certificate, `tokio-rustls`) serving the auth,
  version, node, VM and console endpoints. Tests pin its fingerprint, so the
  real `insecure + pin` path is exercised. Run
  `cargo test -p sorng-proxmox` from `src-tauri`.
- **Frontend:** `npx vitest run tests/proxmox tests/integrations` covers the
  panel adapter, hydration from saved fields and vault secrets, the TFA
  state machine, the certificate-probe prompt and the console hook.
- **E2E (opt-in, shipping in t67 phase 3):** `e2e/helpers/fixtures/mock-pve/server.mjs`
  is a Node HTTPS mock on port `18006` with the same endpoints, driven by
  `e2e/specs/28-proxmox/proxmox-panel.spec.ts` against the built Tauri
  binary. Until it lands, the spec is listed as lab-only in the
  [E2E tier map](../testing/e2e-tier-map.md).
