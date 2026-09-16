---
title: Encrypted credential vault archives
description: Select reusable database credentials for supported login adapters and transfer protected vault archives.
hide_page_header: true
---

# Encrypted credential vault archives

## Select a reusable credential for login

1. Open the owning database and unlock its protected storage. Vault access
   requires native managed database protection, or unlocked app-wide encryption
   covering connection data with native authenticated on-disk protection proof.
   Merely unlocking an app-wide key is not sufficient.
2. Open **Settings → Security → Database credential vault**. Create an entry
   with the fields the target actually needs: username/password, domain, private
   key and passphrase, or authenticators already enrolled with that service.
3. Edit the saved connection. Under its credential source, select **Database
   vault**, then **Reusable vault credential**. Save the connection. This stores
   a reference to that database's entry, not another copy of its secrets.
4. If a server challenge should use a particular authenticator, explicitly choose
   **Vault authenticator for login challenges** and save. Nothing selects the
   first authenticator automatically. Leaving this unset keeps codes manual;
   SSH's TOTP authentication mode requires an explicit selection.

The current login adapters cover **SSH**, **RDP**, **HTTP/HTTPS websites**, and
**Synology NAS API / File Station**. Selecting a vault entry does not add vault
login support to FTP, VNC, or every other protocol. Unsupported modes, malformed
references, missing fields and inaccessible owning databases fail closed; they
do not use a connection-local password or search another database's vault.
Referenced SSH transport hops do not yet support vault credentials and are
refused rather than silently using local hop credentials.

### SSH and RDP

For SSH, choose the connection's password, key, or TOTP authentication mode.
Key mode reads private-key text from the selected vault entry into the native
SSH attempt in memory; it does not require writing a temporary key file. Add the
key's passphrase if encrypted, and an account password if the server requires
both public-key and password authentication. A selected TOTP authenticator can
answer a supported server verification-code challenge; this is not support for
arbitrary PAM conversations, push approval, or hardware-token ceremonies.

For RDP, provide the vault username/password and domain when required. The vault
adapter does not turn an interactive Windows or identity-provider challenge into
automatic MFA.

In SSH, RDP and HTTP/HTTPS sessions, open the session's **2FA Codes** control to
use **Vault authenticator codes**. Choose **Generate** for a named authenticator,
then **Copy** explicitly. The panel neither pastes nor submits automatically.
Codes disappear when expired, hidden, closed, or no longer authorized by the
owning database; closing the panel stops its timer. Connection-local
authenticators are ignored while a vault credential is selected.

### HTTP/HTTPS websites and automatic MFA

Select the application's supported manual, Basic, Digest or reviewed form-login
mode in **Application** settings. A website profile is not a guarantee that every
custom template, version, SSO redirect or authentication plugin is compatible.
Vault website login cannot be combined with connection-local custom headers,
cookies or literal form-field credentials; remove those values or deliberately
choose the separate connection-local authentication mode.

Automatic codes are a separate, **off-by-default** consent:

1. Use HTTPS with certificate verification enabled, and select the appropriate
   application profile.
2. In **Automatic authenticator codes — optional**, select the vault
   authenticator and the listed **Reviewed 2FA challenge**.
3. Check the displayed HTTPS origin and allowed login paths. Choose **Enable
   automatic codes for this origin**, then save the connection.

The reviewed challenge list is authoritative. Current profiles include DSM 7,
Tactical RMM, Apache Guacamole's TOTP extension, Gitea, WordPress's Two-Factor
plugin, Bitwarden/Vaultwarden and Nextcloud's `twofactor_totp` app. These are
specific challenge layouts, not generic support for all MFA on those products.
Only a transient code reaches the matching current website document; no TOTP
seed, recovery code or remembered-device preference is injected. Rejected codes
are not automatically resubmitted. Changed origins, access, profiles or
authenticator choices require fresh review. Unsupported forms, CAPTCHA, push,
passkeys and enrollment remain interactive; use the manual codes panel where
appropriate. See [HTTP application profiles](http-application-profiles.md) for
profile-specific routing and challenge limits.

### Synology API versus DSM website

For **Synology NAS API / File Station**, save a vault entry containing the NAS
username and password. To answer DSM's code request automatically, choose one of
the entry's authenticators in the connection's Synology access settings under
**Two-factor authentication — automatic one-time codes**. It is the same choice
as **Vault authenticator for login challenges**. A connection with local
credentials can use a connection-local authenticator instead. Its secret is
stored with the connection like the DSM password, and database exports remove
it; it is never copied into the vault. Either way the Synology access settings
store only which authenticator to use, never its secret. An encrypted archive
keeps a vault authenticator choice with its entry and drops a connection-local
one.

A code is generated only after DSM returns an OTP-required challenge, and is
submitted once. The app waits for a fresh time window rather than send an
automatic code from a window in which a code may already have signed in to the
same NAS address and account. If DSM rejects the code, or no code can be
generated (for example, the vault is locked or the authenticator is gone), the
challenge dialog opens with a notice and nothing is retried automatically.
Enter a fresh code or cancel. Push approval, security keys and unsupported MFA
require the supported interactive DSM flow, not an invented API bypass. See
[automatic one-time codes](synology-file-station.md#automatic-one-time-codes).

A vault-backed NAS API connection can also remember DSM's **trusted device**
token after a successful two-factor sign-in. This is off unless you choose to
trust the device. Local-credential connections cannot use it, even with a
connection-local authenticator. The token
lets that DSM account skip the one-time code, so it is handled more strictly
than other vault fields:

- It is stored only in the connection's own vault entry, encrypted with the
  owning database. It is matched to the saved NAS address (scheme, host and
  port) and the DSM account name.
- It is never included in encrypted vault archives. Import drops any trusted
  device found in an archive. Generic database JSON exports and imports refuse
  vault data entirely.
- It is used only on the computer that enrolled it. The entry records DSM's
  device name, which is built from this computer's name. Native sign-in sends
  the token only when that name matches the local computer. A copied or synced
  database on another computer, or a renamed computer, asks for a code again
  and forgets the stale token. This computer-name check is a weak binding; it
  prevents silent reuse rather than defeating a determined attacker who has
  the unlocked database.
- The token is never displayed, logged or included in error text. Open the
  vault entry's **Trusted NAS devices** list to see the NAS address, account,
  device name and date. Choose **Forget trusted device**, then save, to require
  a code again. DSM can also revoke trusted devices from its own security
  settings.

This API session is separate from a **Synology DSM HTTP/HTTPS website** tab.
Website form login and website automatic MFA use the profile/origin consent
above; logging into either surface does not authenticate the other. The NAS API
authenticator needs no origin consent because its code goes only into the API
sign-in request. With vault credentials both surfaces read the same vault
authenticator, and changing it from the NAS API settings turns website automatic
codes off until they are enabled again. With local credentials each surface keeps
its own authenticator choice. Choosing an authenticator for one surface never
enables automatic codes on the other. Reverse proxy redirects, TLS trust and
destination approvals remain separate controls.

### Social sign-in and passkeys

In an HTTPS website tab linked to a vault entry, choose **Vault social and passkey
sign-in** to explicitly load its binding metadata. Select a matching binding to
open the saved website's original HTTPS login address in the external browser.
For a social binding, enter the **Website HTTPS origin where sign-in starts**,
not an unrelated identity provider's callback address.
Social bindings must name that exact starting origin; the current implementation
accepts passkey bindings for the exact saved hostname or a valid parent relying-party
domain, checked against the public suffix list including private domains. The browser and
authenticator still perform the actual WebAuthn ceremony. This handoff never
asserts successful authentication and never transfers browser cookies or login
state back into the embedded tab. The external browser also has its own network
and proxy configuration. Native browser-launch failure remains visible;
there is no fallback to connection-local passwords. A binding cannot export or
clone a hardware authenticator's private key; sign in or enroll again as required.

## Export and import an encrypted archive

Open **Database credential vault** in the owning protected database. Use **Export
archive** to select credentials and, optionally, their linked connections. The
`.sorngvault` file contains only AES-256-GCM authenticated ciphertext and encryption
metadata. Its PBKDF2-SHA-256 password derivation uses 600,000 iterations, a fresh
16-byte salt, and a fresh 12-byte IV. The password must have at least 12 characters
and satisfy the app's password policy. Keep it separately: there is no recovery
key or plaintext export fallback.

Use **Import archive**, enter its password, and select the file. Review the names
and counts before choosing **Import reviewed records**. Decryption alone does not
change the database. Import appends credentials and linked connections together in
one protected database compare-and-swap save. Existing IDs are never overwritten;
credential, connection and authenticator IDs are remapped together. Concurrent
changes, database switches, locks and stale review receipts refuse the operation.

## What travels

Username, password, domain, private-key text, key passphrase and TOTP seeds are
included only in the encrypted credential records. Social-login and passkey
bindings are descriptive metadata marked `portable: false`: they do **not** carry
OAuth sessions, browser cookies, hardware/private authenticator keys or an ability
to sign in. Sign in or enroll again on the destination. Ignored connection-local
credentials, custom headers and literal login form values are not copied as an
alternative authentication source.

This is a **credential vault bundle**, not a whole-app backup. Selected linked
connections must reference selected credentials. Supported inline links to other
selected connections are remapped. Missing connection links, external saved
routes/VPN configurations and script or macro library dependencies are rejected,
not silently discarded. Export credentials alone if those dependencies must be
recreated separately.

Connections are imported at the database root; source folders are not copied.
Custom icon keys remain, but separate icon assets are not bundled. Automatic
login, MFA, website automation and redirect authorization need fresh review.
Website login mode becomes manual; choose the desired login mode again. Other
appearance/settings are retained where supported, with automation disabled.
Certificate and host-key verification starts fresh. No imported connection runs
or connects automatically.

## Limits and protection

The archive accepts up to 1,000 credentials (8 MiB combined vault data), 1,000
linked connections, 16 MiB decrypted payload and 24 MiB encrypted file. File reads
are bounded while streaming, not just by a prior size check. Malformed data,
unsupported versions, orphan references and authentication failures are refused.

The destination must have native managed database protection, or unlocked
app-wide encryption covering connection data. Ordinary JSON/third-party formats
cannot safely carry vault IDs by themselves and direct you to this archive flow.
Nothing falls back to a global credential store or silently selects local secrets.

[Database documents](database-documents.md) likewise need one verified layer:
unlocked managed protection or applicable, unlocked global Connections encryption
of the owning file, including an OS-vaulted global key. A setting or unlocked key
alone is insufficient. A vault archive does not include documents or attachments.

Archive passwords and decrypted contents exist transiently in application memory
while the operation or review is open. Closing the dialog or losing the owning
database scope drops those references; JavaScript does not guarantee physical
memory erasure. Native file dialogs are used, and only encrypted bytes are written.

## Acceptance matrix

This matrix distinguishes implemented paths and regression evidence from a live
deployment acceptance test. It does not mean every login method works on every
server or that a mock native invocation proves remote authentication.

| Path                                         | Acceptance evidence                                                                                                                                                                                                                                | Boundary / remaining deployment check                                                                                                                                                                       |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protected vault selection and archive import | Actual Provider tests cover protected access, atomic credential+connection import, fresh IDs, readback, owner changes and post-commit warning behavior; codec tests perform authenticated encryption/decryption.                                   | Native desktop file-picker interaction is not proven by mocked file-I/O tests. Verify save/open on the packaged app; no plaintext fallback.                                                                 |
| SSH vault password/key/TOTP                  | An isolated loopback OpenSSH container passed encrypted in-memory key+command execution, wrong-key refusal without agent fallback, refusal when a required password was absent, and key+password success. Native tests also cover TOTP parameters. | Live-server algorithms and authentication combinations must match. The container did not prove a live TOTP/PAM login; arbitrary PAM, hardware-token and vault-backed transport-hop support are not implied. |
| RDP vault login                              | Adapter regressions verify username/password/domain routing and owner checks.                                                                                                                                                                      | A live Windows/domain/MFA login is not established by those fixtures.                                                                                                                                       |
| Manual vault TOTP panel                      | Mounted panel regressions cover explicit generation/copy, immediate copy guard, expiration, hidden/locked/scope changes, late results and unmount without polling.                                                                                 | No automatic paste; no claim that a generated code is accepted by a remote service.                                                                                                                         |
| HTTP/HTTPS login and automatic MFA           | Runtime/profile/client fixtures cover scoped credential delivery, reviewed challenge matching, explicit consent and stale/rejected-code handling.                                                                                                  | Live compatibility depends on the listed profile layout, origin, version and deployment; external SSO and unsupported challenges stay manual.                                                               |
| Synology API TOTP                            | Hook regressions cover OTP-required handling, one selected-code submission, invalid-code/manual fallback and cancellation.                                                                                                                         | No live NAS account or MFA device was used for these tests; website authentication is a separate session.                                                                                                   |
| Social/passkey external handoff              | Mounted regressions cover explicit opening, exact social origin, public-suffix/IDN checks, changed bindings, owner revocation and secret-free URLs.                                                                                                | No live OAuth or WebAuthn ceremony is claimed. Browser/authenticator compatibility and re-enrollment remain user-controlled.                                                                                |

Relevant test sources include `tests/security/vaultArchive.test.ts`,
`tests/connection/DatabaseCredentialVaultPersistence.test.tsx`,
`tests/security/RuntimeVaultTotpPanel.test.tsx`,
`tests/security/VaultInteractiveSignIn.test.tsx`,
`tests/security/vaultPasskeyAuthority.test.ts`, and
`tests/synology/useSynologyFileConnection.test.tsx`.

The isolated SSH acceptance runner is `scripts/test-vault-ssh-inline.mjs`, using
the native `vault_inline_key` integration target. It creates only its own
loopback-bound test container and removes it afterward; this is not evidence from
a user's SSH server. The manual code panel has nine mounted behavioral cases,
and the actual Provider persistence suite has 31 cases, including import success
surviving receipt rotation and a later unrelated save failure reported as a
warning rather than a second import opportunity.
