---
title: Local password policy
description: Configure requirements for new protection and export passwords without changing remote account credentials or existing unlock behavior.
hide_page_header: true
---

# Local password policy

Settings → Security → Local password policy configures requirements for **new or changed** application/database protection passwords and encrypted exports. It is off by default. Existing floors remain: four characters for databases, eight for application protection and portable master-key exports. Ordinary file exports retain their existing nonempty-password and configurable strength checks when this policy is off. Optional rules add a 4–128-character minimum and uppercase, lowercase, digit or ASCII punctuation requirements. Length counts Unicode characters; these rules do not measure resistance to guessing.

Apply explicitly to save changes. Storage must be available; a failed save does not authorize a weaker native policy. The local generator uses cryptographic randomness and the saved policy, does not copy or save its output, and clears its displayed result on lock. Remote account credentials and the separate KeePass toolkit are not governed by this local protection policy.

Unlocking, decrypting/importing existing files, master-key disaster recovery, ordinary saves with an existing database password, and retained managed-database slots do not revalidate old passwords. Choosing a **new destination database password** while importing or cloning is a new-password operation. Master-key disaster recovery is separate: it must authenticate an existing backup even when canonical settings are unreadable; review the local protection password after recovery.

Native master-key setup/change, portable master-key export and new managed database password slots enforce the persisted policy directly. Legacy database and ordinary export encryption remain frontend WebCrypto: the application asks native code to read and validate the persisted policy before deriving a new key. An opaque ciphertext subsequently passed to the legacy save API is **not cryptographic proof** of password-policy compliance. Browser-only mode uses its loaded local settings; it has no native enforcement boundary. No policy or encryption-format migration is performed.

## Password-field generator

The wand beside supported editable password fields opens a themed generator. It is available in connection editing, Quick Connect, SSH/HTTP/ARD/Synology credentials, RDP gateway and per-connection proxy authentication, security setup, and vault password editing. Tokens, authenticator codes/seeds, existing key-decryption passphrases, confirmation and unlock fields are not opted in; disabled and read-only inputs never offer generation.

The default is 20 characters with lowercase, uppercase, digits and symbols, excluding `I`, `l`, `1`, `O`, `0`, `o` and `|`. Length is configurable from 8 to 128, subject to the destination field's limits. Each enabled character type appears at least once. Generation uses Web Crypto with unbiased sampling and fails closed if secure randomness is unavailable. These settings are independent of the local protection policy above; the destination form still validates its own requirements.

Opening, changing options, regenerating or cancelling never changes the destination field. **Use password** fills it through its existing input handler without submitting or saving the form. It does not change a password on a remote service. **Copy** is deliberate and writes only to the clipboard. Escape dismisses the popover and returns focus to the wand; applying returns focus to the input. Draft passwords and generator settings exist only while the popover is open and are not logged or persisted. After explicit application, the existing form's normal save behavior applies.

New password fields can opt in with `PasswordInput`'s `generateable` prop. Do not enable it for generic secret/token inputs or OTP fields. The reusable component preserves controlled/uncontrolled input behavior, forwarded refs, names and callbacks.
