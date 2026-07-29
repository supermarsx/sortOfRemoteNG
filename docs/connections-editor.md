---
title: Connections & Editor
eyebrow: Use the app
description: Understand the saved connection model, folders, editor tabs, searchable settings, and how protocol-specific configuration stays discoverable.
permalink: /connections-editor/
---

## Connections, folders, and sessions

A **connection** is a saved configuration record. A **folder** organizes records but does not create a session. A **session** is the live runtime created when a connection opens. Keeping those concepts separate makes clone, import, reconnect, and detached-window behavior easier to reason about.

The tree supports nested folders, tags, favorites, custom icons, ordering, and color cues. These are organizational attributes; they do not change transport security or protocol behavior.

## Editor map

| Tab      | Purpose                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------- |
| Basics   | Connection/folder type, name, protocol, target, port, and primary credentials                            |
| Protocol | Protocol-specific subtabs such as authentication, display, security, Network Path, and advanced controls |
| Behavior | Focus policy, close/retry settings, and versioned lifecycle automation rules                             |
| Organize | Parent folder, tags, icon, color, favorite state, and ordering metadata                                  |
| Notes    | Human-readable description and operational context                                                       |

Folders intentionally hide connection-only tabs. Protocol subtabs change when the protocol or target operating system changes.

## Search settings instead of hunting

The editor’s settings search indexes visible labels, help copy, option text, safe current values, and protocol-aware destinations. Selecting a result opens the owning top-level tab and, when applicable, the exact Protocol subtab.

Sensitive keys—passwords, tokens, private keys, passphrases, secrets, recovery codes, and similar values—are excluded from the search index. Search metadata should navigate to a control without copying secret material into searchable text.

## Protocol subtabs

RDP groups connection identity, authentication, display/input, resources, security, Network Path, network transport, advanced settings, and recovery. SSH groups authentication, terminal overrides, Network Path, connection networking, and recovery.

The dedicated [Network Paths]({{ '/network-paths/' | relative_url }}) page explains why routing is separate from ordinary TCP, gateway, and terminal settings.

Cloud connections use a provider subtab whose visible fields map directly to
the provider-specific non-secret saved settings. Their service-account JSON,
client secret, API token, or API key remains in the protected connection
credential boundary. OVHcloud uses three masked inputs that serialize only
inside that protected credential. See
[Cloud & Lights-Out Connections]({{ '/cloud-and-lights-out/' | relative_url }})
for required fields, legacy-record migration, and reopen behavior.

## Save and reopen contract

Stable references—not display names—should be persisted for reusable collections such as chains, profiles, VPN connections, and parent folders. The editor keeps an unavailable current ID visible as an orphan so a deleted dependency can be cleared or replaced instead of silently disappearing.

Before connecting a critical target:

1. Save the connection.
2. Reopen it and confirm the selected protocol, IDs, and overrides.
3. Review any Network Path diagnostics.
4. Connect and inspect the resulting session rather than assuming editor presence equals runtime support.

## SSH resilience and continuity

New installations enable recovery for an established SSH session by default. The bounded policy makes up to 20 attempts, starts at 2 seconds, doubles the delay, and caps each delay at 30 seconds. This gives a host and its SSH daemon time to complete an ordinary reboot without retrying at a tight fixed interval. Existing explicit settings and per-connection retry overrides remain authoritative.

SSH keepalive is enabled by default with a 30-second interval and three probes. Keepalive helps a live transport survive idle NAT and firewall timeouts; it cannot preserve a TCP connection while the remote machine is rebooting. When an established transport is lost, recovery creates a new authenticated SSH transport and a new PTY after the host becomes reachable.

The client does not currently provision or automatically attach `tmux`, GNU `screen`, or Mosh. Consequently, a reconnect restores access to the host but cannot resurrect the old remote shell or any foreground process that died with it. Start important long-running work inside a server-side session manager if it must survive a network interruption or client restart.

Renderer remounts can reattach to a still-live native backend actor within the same application process. A full application exit or local machine reboot destroys that in-memory actor; **Reconnect sessions on reload** can establish a new connection from persisted metadata, but it is not process continuity.

Automatic transport recovery applies only after a session was successfully established. Authentication failures, rejected or changed host keys, invalid routes, and user-requested disconnects require user action and must not be retried as transient network loss. This avoids repeated credential attempts and account-lockout pressure.

## Connection-level safety

- Use per-connection trust exceptions sparingly; prefer the central trust policy.
- Keep descriptive notes free of credentials.
- Treat exported connection files as sensitive whenever credential inclusion is enabled.
- Use folders and tags for policy grouping, but do not treat them as access controls.
- Review behavior actions that can close sessions, run scripts, or manipulate windows.
