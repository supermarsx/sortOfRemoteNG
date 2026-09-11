# Encrypted credential vault archives

Open **Database credential vault** in the owning protected database. Use **Export
archive** to select credentials and, optionally, their linked connections. The
`.sorngvault` file contains only AES-256-GCM authenticated ciphertext and encryption
metadata. Its PBKDF2-SHA-256 password derivation uses 600,000 iterations, a fresh
16-byte salt, and a fresh 12-byte IV. The password must have at least 12 characters
and satisfy the app's password policy. Keep it separately: there is no recovery
key or plaintext export fallback.

In an HTTPS website tab linked to a vault entry, choose **Vault social and passkey
sign-in** to explicitly load its binding metadata. Select a matching binding to
open the saved website's original HTTPS login address in the external browser.
Social bindings must name that exact starting origin; the current implementation
accepts passkey bindings for the exact saved hostname or a valid parent relying-party
domain, checked against the public suffix list including private domains. The browser and
authenticator still perform the actual WebAuthn ceremony. This handoff never
asserts successful authentication and never transfers browser cookies or login
state back into the embedded tab. Native browser-launch failure remains visible;
there is no fallback to connection-local passwords.

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

Archive passwords and decrypted contents exist transiently in application memory
while the operation or review is open. Closing the dialog or losing the owning
database scope drops those references; JavaScript does not guarantee physical
memory erasure. Native file dialogs are used, and only encrypted bytes are written.
