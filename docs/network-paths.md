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
4. The legacy single-proxy fields.

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
- An unsupported hop is reported before the session attempts to use it.
- A disabled or incomplete dependency cannot be rescued by lower-priority legacy proxy fields.
- Runtime preparation is cleaned up when connection setup fails or the owning session ends.

See [Protocols]({{ '/protocols/' | relative_url }}) for client maturity and [Security]({{ '/security-overview/' | relative_url }}) for handling route credentials and diagnostic output.
