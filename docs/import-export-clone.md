---
title: Import, Export & Clone
eyebrow: Use the app
description: Move connection data through previews, explicit conflict policies, controlled secret handling, and database-aware cloning.
permalink: /import-export-clone/
---

Portability workflows are designed around review before mutation. Import parses into a preview model, export makes inclusion choices explicit, and clone remaps database-owned sidecars instead of copying identifiers blindly.

VPN sidecars are distinct from tunnel layers: a tunnel layer keeps its own layer ID and references the imported VPN profile through `vpn.configId`. Import and clone recreate a selected OpenVPN, WireGuard, Tailscale, or ZeroTier profile only when its required credentials are available, then remap every dependent connection and saved tunnel chain to the new profile ID. Legacy mesh-network and layer-ID references are accepted as migration inputs and rewritten to `configId`; they are not confused with the new layer identity.

When credentials are included, OpenVPN imports retain the original `.ovpn` payload as the profile's authoritative configuration so inline certificates and keys are not lost to a partial browser-side parser. WireGuard imports likewise send the untouched `.conf` payload to the native parser, which validates the same one-interface/one-peer contract used at connection time. When credentials are excluded, raw OpenVPN and WireGuard configuration material is removed instead. Imported secrets are never placed in command arguments or included in validation errors.

## Format coverage

| Family               | Recognized formats                           |
| -------------------- | -------------------------------------------- |
| Native / interchange | JSON, XML, CSV                               |
| Connection managers  | mRemoteNG, RDCMan, Royal TS / TSX, MobaXterm |
| Terminal clients     | Termius, PuTTY, SecureCRT                    |

Compatibility means the importer recognizes the source format. It does not mean every source-specific field has a native equivalent or that every imported protocol has a complete session client. Review [Protocols]({{ '/protocols/' | relative_url }}) before applying a large migration.

## Import safely

<ol class="steps">
  <li><strong>Select the source and format.</strong> Use automatic detection only when the preview clearly identifies the input.</li>
  <li><strong>Inspect parsed items.</strong> Check names, endpoints, ports, protocols, folders, and warnings before apply.</li>
  <li><strong>Resolve conflicts.</strong> The preview classifies no conflict, same ID, same name, or same endpoint.</li>
  <li><strong>Choose a policy.</strong> Duplicate, skip, or rename intentionally; do not assume the importer will overwrite an existing connection.</li>
  <li><strong>Apply to the intended database.</strong> Confirm the selected destination and unlock it if required.</li>
  <li><strong>Reopen a sample.</strong> Verify protocol settings, credentials policy, and folder placement before trusting the full batch.</li>
</ol>

<div class="callout callout--danger">
  <strong>Imported protocol names are not capability proof.</strong>
  <p>RAW, RLogin, and PowerShell-like entries can map to real interactive clients, but a protocol mapping cannot invent vendor-specific fields, credentials, trust decisions, or a reachable target. FTP and SCP imports still have no direct session tab. Review the normalized settings before connecting.</p>
</div>

### Post-import protocol review

The current direct-session behavior is:

| Imported target             | Runtime truth and review required                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw / RAW-TCP / RAW-UDP     | Opens the binary-safe Raw Socket client. Confirm TCP versus UDP, payload encoding, framing, and TLS because a generic vendor export may preserve only endpoint fields.  |
| RLogin                      | Opens the native RLogin terminal after its plaintext-risk acknowledgement is saved. Recheck local/remote usernames and terminal behavior.                               |
| PowerShell / WinRM          | Opens PowerShell Remoting over configured WSMan/WinRM or SSH. Confirm transport capability, authentication, certificate/host trust, and endpoint details.               |
| ARD, Telnet, or Serial      | Opens the dedicated client when the imported record contains enough settings. Serial still needs a valid local device path, driver, and OS permission on this computer. |
| SFTP, MySQL/MariaDB, or SMB | Opens the saved file/query client. Recheck authentication, initial path/database/share, and server reachability.                                                        |
| AnyDesk or RustDesk         | Hands off to the installed native application; importing an ID does not install that client.                                                                            |
| VNC                         | Requires a WebSocket-capable VNC endpoint or compatible proxy; a conventional raw-RFB TCP endpoint is not bridged by the app.                                           |
| FTP or SCP                  | Preserved as recognized connection types, but no direct interactive tab is wired yet. Prefer SFTP where possible.                                                       |

Imports never prove that a live target is available. Test a small sample with non-production credentials and verify any driver, native client, proxy, certificate, or host-key requirement before applying a bulk migration.

## Export deliberately

Before exporting, decide whether the artifact needs secrets and whether the destination is within the same trust boundary. Prefer the smallest useful selection and keep generated files out of source control.

- Verify the selected connections and folder scope.
- Exclude credentials unless the receiving workflow truly needs them.
- Protect encrypted artifacts with a strong, separately shared password.
- Treat plaintext JSON, XML, CSV, and diagnostic exports as sensitive until inspected.
- Test restoration from important backups; a file existing is not proof that it is usable.

The detailed at-rest and backup threat model lives in [Encryption at rest]({{ '/security/encryption-at-rest/' | relative_url }}).

### VPN portability and credentials

VPN definitions have a separate credentials choice even when the export contains no ordinary connections. The four managed providers use the same fail-closed rules:

| Provider  | Removed when credentials are excluded                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------- |
| OpenVPN   | Username, password, inline/raw configuration, client key, certificate/auth/config paths, custom flags |
| WireGuard | Private key, preshared key, raw config path, and interface hook commands                              |
| Tailscale | Authentication key, state/socket paths, and custom flags                                              |
| ZeroTier  | Identity secret, authentication token, home/credential path, and custom flags                         |

A sanitized VPN recovery record keeps its stable exported profile ID, name, and non-secret routing fields, but is marked non-executable. Provider IPC does not persist a generic disabled marker, so import and clone omit that profile instead of creating something that could appear runnable. Direct and inline references to the omitted profile are removed with warnings; dependent saved chains are omitted. Stable tunnel layer IDs are preserved whenever a credential-complete profile is actually created and remapped.

Including VPN credentials is supported only by an encrypted JSON export with a non-empty password. The export fails closed if a selected VPN profile would otherwise be written with credentials to plaintext. If the native profile list reports that a secret exists but deliberately does not return its value, the export marks that recovery record incomplete and non-executable instead of claiming the backup contains the secret; import and clone omit it with a warning.

On import, turning off **Include credentials** sanitizes VPN recovery records as well as ordinary connections, then omits those VPN profiles. If a selected VPN profile lacks exported credentials or cannot be created, any direct or inline association to it is removed with a warning. A saved tunnel chain that depends on an unresolved VPN profile is omitted with a warning, preventing an old profile ID from binding accidentally to an unrelated local profile.

Native backups from older builds are migrated from camel-case or snake-case sidecars, including `vpn_connections`, `open_vpn`, `wire_guard`, `tail_scale`, `zero_tier`, and provider configuration fields such as `remote_host`, `private_key`, `auth_key`, and `network_id`. Import still assigns new local profile IDs; only references are remapped, while tunnel layer identities remain stable.

## Clone connections and databases

Connection clone creates a new identity and can omit secrets unless inclusion is selected. Database clone is broader: it targets a destination database, preserves folder relationships, remaps database-owned sidecars, and can add tags during the operation.

Credentials are included by default in the database clone workflow because it is intended for movement inside the same trust boundary. Turn that off when the destination has different operators, storage guarantees, or retention rules. With credentials off, VPN sidecars are not recreated: affected associations are removed, dependent chains are omitted, and the clone result lists the required follow-up.

After cloning, verify:

- the destination database and collection name;
- connection and folder counts;
- tags and parent relationships;
- behavior rules and saved network-path references;
- credential inclusion; and
- a small sample of real session opens.

See [Security]({{ '/security-overview/' | relative_url }}) before moving secrets and [Connections & Editor]({{ '/connections-editor/' | relative_url }}) for the saved connection model.
