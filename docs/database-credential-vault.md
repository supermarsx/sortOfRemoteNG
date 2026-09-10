---
title: Database credential vault
description: Database-owned reusable credentials and explicit connection references.
---

# Database credential vault

Open **Settings → Security → Database credential vault → Manage database credentials**. Each database owns an independent vault inside its managed protection. Open and unlock that database first; the native desktop app verifies its protection before reading or saving. There is no global or plaintext fallback and no automatic migration from connection-local credentials, the rotation tracker, or integration credential stores.

Create an entry with a name and one or more credential types: username, password, domain, private key, key passphrase, or TOTP authenticators. Secret fields start masked; reveal a private key to edit its multiline contents. TOTP entries contain an existing Base32 seed and its digits, period and algorithm—not a current one-use code. This editor does not enroll an authenticator or submit codes.

Social sign-in and passkey entries are **metadata only**, explicitly non-portable. They describe a provider and HTTPS origin or relying-party domain; OAuth tokens, browser sessions and authenticator private keys are not captured. Sign-in still requires the original provider/browser or hardware authenticator.

In a connection's **General → Credential source**, choose Connection-local or Database vault and select a same-database entry by name. The picker loads only names and available credential types. It saves a reference, not a secret copy. Existing local fields are preserved but ignored while the vault reference is selected. Runtime support is adapter-specific: an unsupported or missing reference must fail closed rather than use local credentials. Adding a reference does not imply every protocol supports every credential combination.

Editing explicitly loads that entry's facets into the private draft. Changes save atomically against the reviewed database revision; a conflict, failed save, lock or owner change does not publish an optimistic replacement. Preserve the draft and reload/review before retrying a failed save. Closing the editor asks before discarding changes; locking or changing the database immediately removes the private editor. Deleting a vault entry does not revoke it at the remote service and can leave connections requiring a replacement.

Vault payloads remain separate from connection and session state. Runtime adapters and portable export/import are separate integration boundaries; this manager does not promise portable social sessions, passkeys, or support in every export format.

## Connection runtime support

The connection-session adapters support SSH password login, RDP username/password with an optional domain, and HTTP(S) Basic, Digest or the reviewed website form profiles. Each attempt verifies the saved target/reference and owning protected database, then resolves only the required facets. No resolved pair is saved on a connection, session, or the global runtime-connection registry. Failed or missing references stop before connection automation; they never use preserved local login values. Reconnect and reattachment repeat the access checks.

SSH requires a nonempty password. RDP preserves an explicitly present empty password and does not substitute a connection-local domain when the vault has none. Manual website profiles disclose no vault facets. Website TLS/trust and same-origin boundaries remain unchanged. Connection-local custom headers/cookies and literal form automation fields cannot be combined with vault website login in this adapter. Local automatic TOTP is disabled; no first authenticator is selected implicitly. Cross-origin redirect forwarding does not carry vault credentials or references.

Vault private-key material, key passphrases, TOTP code generation/enrollment, social/passkey authentication and other protocol adapters are not integrated in this slice. Use a supported password mode or the appropriate interactive authenticator; storing a facet is not proof that a native protocol can consume it. Referenced SSH jump/bastion hops currently require connection-local credentials; a vault-backed or invalid hop reference is rejected before any local or inline fallback. Auxiliary bulk, tunnel and diagnostic workflows are separate adapters, not covered by the session-adapter support claim. Verification uses local fixtures, not live SSH/RDP servers or provider logins.

## Moving connections between databases

Selected-connection imports and clones cannot copy database-vault references yet. They stop before creating connections or sidecars, even if the destination happens to contain an entry with the same ID. Ignored local credentials are never substituted. To transfer such a connection, explicitly choose and review connection-local credentials in the source first, or duplicate the **entire protected database** with new destination protection; that operation preserves its complete connection and vault namespace.

Dedicated encrypted vault bundle export/import, selected credential dependencies, and atomic merge/remapping are not implemented. A native JSON import declaring a vault (including an empty or malformed one) is rejected rather than silently dropping it. Existing ordinary JSON exports are not vault backups. Social sign-in sessions and passkey authenticators remain non-portable.
