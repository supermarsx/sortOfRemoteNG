---
title: Windows SSH in-memory keys
description: Supported vault-backed SSH key formats and Windows in-memory authentication without plaintext key files or credential fallback.
hide_page_header: true
---

# Windows SSH in-memory keys

Rustls handles TLS; SSH uses a different protocol. Windows SSH keeps libssh2's
native Windows cryptography backend and uses RustCrypto to parse and sign keys
supplied by the database credential vault. No plaintext key file is created, and
this adapter does not fall back to an agent or an unrelated local credential.
Unix continues using the existing ssh2 in-memory API.

Supported in-memory formats are:

| Envelope                                       | Key algorithms                                    |
| ---------------------------------------------- | ------------------------------------------------- |
| OpenSSH, plain or bcrypt-encrypted             | RSA, Ed25519, ECDSA P-256/P-384/P-521, legacy DSA |
| PKCS#8, plain or PBES2-encrypted               | RSA, Ed25519, ECDSA P-256/P-384/P-521, legacy DSA |
| Traditional RSA/DSA/EC PEM, plain or encrypted | RSA PKCS#1, DSA, named-curve EC SEC1              |

Traditional encrypted PEM accepts AES-128/192/256-CBC, 3DES-CBC and legacy
DES-CBC envelopes using their existing EVP-MD5 derivation. These are import
compatibility paths, not defaults for creating new keys. PBES1, unsupported
ciphers/curves, security-key handles, and certificates are not reinterpreted as
ordinary signing keys. Unsupported or malformed input fails closed.

Inputs are limited to 64 KiB. RSA keys retain compatibility from 1024 through
8192 bits; DSA is the SSH `ssh-dss` 1024/160-bit format. Encrypted OpenSSH keys
allow at most 128 bcrypt rounds; PBES2 accepts bounded PBKDF2 (up to 1,000,000
iterations) or scrypt (up to 64 MiB with bounded work). Larger costs must be
re-encoded deliberately; they are never silently reduced.

RSA signatures use the exact algorithm negotiated by libssh2: SHA-512,
SHA-256, or legacy SHA-1. RustCrypto's randomized signing API supplies RSA
blinding. No algorithm preference, host-key trust check, or server authentication
policy is weakened. A public-key authentication response alone is not enough:
the session must be authenticated, including any required password/TOTP step.

## Transport is separate from the login key

An Ed25519 **login key** does not imply support for an Ed25519-only **server host
key**. Windows-native libssh2 has different host-key, key-exchange and cipher
capabilities from its OpenSSL backend. In particular, Ed25519-only host-key and
Curve25519-only key-exchange configurations remain unsupported by WinCNG. The
client must not silently weaken a server's policy to connect.

The bundled Windows build explicitly enables libssh2's existing Windows 10
ECDSA/ECDH implementation for P-256, P-384 and P-521. This supports the unchanged
default modern OpenSSH fixture without enabling weaker server algorithms.

The default/full Windows Cargo graph no longer needs `openssl-sys` for this
adapter. This does not mean every packaged native DLL is OpenSSL-free: optional
dynamic bundles can contain externally built libssh2 or librdkafka and their
OpenSSL DLL dependencies. Those packaged runtimes are not removed here.

## Callback safety and verification

The adapter uses libssh2's documented public-key signing callback. It holds
`ssh2::Session::raw()`'s mutex for the entire blocking call and rechecks blocking
mode under that lock. The exact username, service, request kind, algorithm,
public-key blob, session pointer and bounded packet framing are checked before
signing. Unknown requests fail without triggering an algorithm fallback.

Only a signature buffer crosses the C boundary. Allocation mirrors ssh2's own
keyboard-interactive callback: `libc::malloc` paired with the default libssh2
allocator. Tests free the buffer with the actual `libssh2_free` function. The
local MSVC build's library directives and executable imports confirm matching
dynamic CRT linkage; custom-allocator or mismatched third-party CRT builds are
not supported by this contract. Panics are contained before returning to C.

Owned plaintext buffers and key types use zeroizing storage; cipher cleanup is
explicitly enabled. This is not a guarantee that every compiler temporary or
third-party cryptographic internal allocation is erased.

`scripts/test-vault-ssh-inline.mjs` creates an isolated loopback-only SSH server
for actual native authentication tests, then removes only that test container.
The dedicated `vault_inline_key` target is separate from the ordinary SSH smoke
test. Parser/signature tests additionally exercise legacy DSA, malformed data,
wrong passphrases, named-curve identity and callback ownership. This is local
synthetic acceptance coverage, not a claim about every production SSH server.

Primary contracts: [libssh2 callback API](https://libssh2.org/libssh2_userauth_publickey.html),
[ssh2 Session source](https://docs.rs/ssh2/0.9.6/src/ssh2/session.rs.html), and
[RustCrypto SSH key formats](https://docs.rs/ssh-key/0.6.7/ssh_key/).
