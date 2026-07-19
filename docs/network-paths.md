---
title: Network Paths
eyebrow: Use the app
description: Understand how VPNs, proxies, tunnels, and SSH hops are selected, validated, and applied to each connection.
permalink: /network-paths/
---

Network Path turns connection routing into saved, inspectable configuration. It does not silently infer a route from every field that happens to be present: one source is selected, the source is normalized, and the protocol adapter either accepts the resulting plan or fails with an explanation.

## Precedence

The resolver evaluates sources in this order:

1. A saved **connection-chain reference**.
2. A saved **proxy-chain reference**.
3. A saved **tunnel-chain reference**, or the connection's inline tunnel settings when no saved tunnel is selected.
4. The legacy single-OpenVPN fields, when no modern tunnel source is selected.
5. The legacy single-proxy fields.

A selected saved tunnel replaces the inline tunnel for that connection. Lower-priority sources do not merge into a higher-priority chain behind the scenes.

<div class="callout">
  <strong>Why precedence matters</strong>
  <p>It makes reopen and reconnect behavior deterministic. The summary shown in the editor is derived from the same selected source that the runtime adapter receives.</p>
</div>

## Supported routing by protocol

| Route layer                                           | SSH                                             | RDP                                                                               |
| ----------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| OpenVPN, WireGuard, Tailscale, or ZeroTier prefix     | Supported when the referenced profile is usable | Supported when the referenced profile is usable                                   |
| HTTP / HTTPS proxy                                    | Supported as an explicit proxy hop              | Proxy-only routes are rejected                                                    |
| SOCKS4 / SOCKS5 proxy                                 | Supported as an explicit proxy hop              | Proxy-only routes are rejected                                                    |
| SSH jump or tunnel hop                                | Supported                                       | Supported only when it is the final socket-producing bastion after any VPN prefix |
| Dynamic proxy chains or `ProxyCommand` / stdio routes | Rejected                                        | Rejected                                                                          |

RDP has a deliberately narrower contract: a VPN may prepare the network, and a final SSH bastion may produce the socket used by the RDP session. An arbitrary proxy chain is not treated as equivalent.

## VPN profile contract

The VPN library, connection editor, imports, and session runtime share one executable-provider catalog. The currently executable providers are **OpenVPN, WireGuard, Tailscale, and ZeroTier**. A provider is shown as selectable only when the app can persist its profiles, manage them from the VPN library, and acquire and release it for an SSH or RDP session. Experimental low-level provider commands are not advertised as working connection routes.

Every association stores the saved VPN profile ID in `vpn.configId`. A tunnel layer also has its own independent `id`; that layer ID is not sent to the VPN runtime. The connection editor, saved tunnel-chain editor, and tunnel-profile editor all select from the same provider-scoped profile snapshot. Older data that stored the profile ID in `mesh.networkId` or directly in the layer ID is read as a migration fallback, and the next editor/import remap writes the canonical `configId` form.

The editor validates a selected ID against the matching provider snapshot. A successfully loaded provider that no longer contains the ID is shown as an unavailable/deleted association and connection is blocked. A provider store that is still loading or failed to load is shown as checking/unverified instead—it is never mislabeled as deleted, but connection still fails closed until it can be verified.

SSH and RDP sessions acquire their ordered VPN prerequisites before opening the target transport. Leases are shared by provider and profile ID, so concurrent sessions reuse one verified tunnel and only the final owner releases it. A partial acquisition rolls back the VPNs acquired for that attempt in reverse order. Closing a session releases its leases even when the remote transport failed after the network path was prepared.

| Provider  | Managed behavior                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenVPN   | Runs a tracked foreground process, waits for the canonical readiness marker, and keeps imported `.ovpn` content as the authoritative configuration. Username/password or an auth file may override its authentication source without exposing a password in command arguments. Manual TLS Auth and TLS Crypt profiles require their matching key files. |
| WireGuard | Imports `.conf` content through the native parser, supports one interface and one peer, keeps local interface addresses separate from peer `AllowedIPs`, and rolls back the interface if address, DNS, or route setup fails. Hooks, custom routing tables, and `FwMark` are rejected by the managed runtime.                                            |
| Tailscale | Controls the machine-wide daemon with a single verified in-process profile owner. An already-running daemon with no verified owner is treated as external and is never adopted or stopped. Funnel, custom daemon state directories, and custom sockets are outside the per-profile contract.                                                            |
| ZeroTier  | Allows one profile per network ID, waits for the network to report `OK`, and applies the explicit managed/global/default/DNS policies. A membership that already exists without an in-process owner is treated as external: sessions may use it, but the app does not adopt, reconfigure, or leave it.                                                  |

Runtime-affecting profile changes require the profile to be disconnected. Renaming a profile does not change the live tunnel and remains available while connected.

VPN associations manage tunnel lifecycle; they do not create a separate per-session network namespace. Provider routes and DNS changes affect the operating system, so keep advertised and allowed subnets narrow enough to avoid conflicts between simultaneously active profiles.

## Configure a path

<ol class="steps">
  <li><strong>Open the connection editor.</strong> Select an SSH or RDP connection and open its protocol settings.</li>
  <li><strong>Open Network Path.</strong> Choose one saved chain or configure the supported inline tunnel fields.</li>
  <li><strong>Read the effective summary.</strong> Confirm that the chosen source and ordered hops match your intent.</li>
  <li><strong>Resolve diagnostics.</strong> Missing references, disabled profiles, unsupported hop kinds, and protocol-incompatible routes must be corrected before connecting.</li>
  <li><strong>Save and reopen.</strong> Confirm the selected reference survives persistence before depending on it for access.</li>
</ol>

## Safe diagnostics

The editor and adapters should expose structural facts—source kind, hop order, profile names, and validation codes—without copying raw provider configuration or secrets into user-facing errors. Passwords, private keys, tokens, and full VPN configuration bodies do not belong in screenshots or issue reports.

If a route fails, capture the connection protocol, selected source type, ordered hop kinds, and sanitized error. Test the referenced VPN or bastion independently before assuming the final protocol client is at fault.

## Failure model

- A reference that no longer exists fails closed rather than falling back to an unrelated route.
- A provider profile store that cannot be read fails closed without rewriting or deleting the association.
- An unsupported hop is reported before the session attempts to use it.
- A disabled or incomplete dependency cannot be rescued by lower-priority legacy proxy fields.
- Runtime preparation is cleaned up when connection setup fails or the owning session ends.

See [Protocols]({{ '/protocols/' | relative_url }}) for client maturity and [Security]({{ '/security-overview/' | relative_url }}) for handling route credentials and diagnostic output.
