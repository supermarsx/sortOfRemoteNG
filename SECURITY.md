# Security Policy

This document describes the security posture of **sortOfRemoteNG**, how to
report vulnerabilities, and the defensive controls that ship with the
application. It is kept in sync with the hardening epics tracked in
`.orchestration/plans/t3.md`.

## 1. Supported Versions

Security fixes are backported to the most recent minor release line. Older
releases receive fixes only for critical (CVSS >= 9.0) issues.

| Version   | Status                                            |
| --------- | ------------------------------------------------- |
| `main`    | Actively developed; receives all fixes            |
| `0.x` (latest minor) | Supported: security + critical bug fixes |
| `0.x` (older minors) | Critical-only, best-effort                |
| Pre-release / nightly | Not supported                            |

Once a 1.0 release is cut this table will be updated with a formal LTS
window. Until then, users are expected to track the latest tagged release.

## 2. Reporting a Vulnerability

Please **do not** open a public GitHub issue for security problems.

- **Email:** `security@vogue-homes.com`
- **Encrypted channel:** the maintainers' PGP public key is published at
  `https://vogue-homes.com/.well-known/sortofremoteng-security.asc`
  (fingerprint is also pinned in this repository's release notes). Encrypt
  sensitive reports to that key before sending.
- **Response SLA:** we acknowledge new reports within **3 business days**
  and aim to ship a fix or mitigation within **90 days**, coordinating
  disclosure with the reporter.
- **Safe harbor:** good-faith research that respects user privacy, does
  not exfiltrate data beyond what is needed to demonstrate the issue, and
  gives us reasonable time to remediate will not be pursued legally.

Please include: affected version / commit SHA, reproduction steps, impact
assessment, and any proof-of-concept. Credit will be given in release
notes unless you request anonymity.

## 3. Threat Model

sortOfRemoteNG is a desktop remote-connection manager (Tauri + Next.js).
In-scope adversaries and assumptions:

- **In scope:**
  - A network attacker between the client and remote hosts (SSH, RDP,
    VNC, Telnet, SoftEther VPN, etc.) who may attempt MITM, downgrade,
    or replay.
  - A malicious or compromised remote server attempting to exploit the
    client (e.g., via crafted protocol messages or malicious updater
    artifacts).
  - A local unprivileged process on the same machine attempting to read
    credentials or the connection store at rest.
  - Supply-chain tampering with release artifacts in transit.
- **Out of scope:**
  - An attacker with root/Administrator on the user's machine or with
    physical access to an unlocked session (they can always defeat
    at-rest encryption by keylogging the master password).
  - Side-channels on shared hardware (Spectre-class).
  - Compromise of the user's OS keychain itself.

Primary assets: stored connection credentials, private keys, session
tokens, and the integrity of the application binary.

## 4. TLS / Certificate-Verification Policy

By default, **all TLS connections verify the server certificate chain and
hostname**. This applies to HTTPS-based providers, the updater, and any
protocol transport that negotiates TLS.

A per-connection **"Skip TLS verification"** toggle exists for legacy
homelab scenarios. Its use is strongly discouraged and is governed by
the following rules (see epic `t3-e15`):

- **Opt-in only.** The toggle is off by default and cannot be enabled
  globally; it is a per-connection setting.
- **Warning UX.** Enabling the toggle surfaces a blocking confirmation
  dialog that names the connection, lists the risks (MITM, credential
  theft), and requires an explicit second click to proceed. The
  connection card then displays a persistent red "TLS verification
  disabled" badge.
- **Breadcrumb logging.** Each time an insecure connection is opened, a
  structured breadcrumb is written to the local audit log
  (`skip_tls=true`, connection id, timestamp) so that incident
  responders can reconstruct exposure. These breadcrumbs are never
  silently suppressed.
- **No silent fallback.** A failed certificate validation never
  auto-downgrades to `skip_tls`; the user must explicitly re-enable the
  toggle.

## 5. Secret-at-Rest Model

Secrets (connection passwords, private keys, SoftEther credentials,
etc.) are sealed by the `sorng-auth` and `sorng-secure-storage` crates
in `src-tauri/crates/`.

- **KDF:** Argon2id with conservative OWASP parameters (memory cost
  `>= 19 MiB`, time cost `>= 2`, parallelism `1`). Migrated in epic
  `t3-e40` from the previous `bcryptjs`-in-renderer design; see below.
- **Cipher:** AES-256-GCM with a random 96-bit nonce per record. The
  ciphertext, nonce, salt, and KDF parameters are stored together so
  parameters can be rotated without re-entering the master password.
- **Master key handling:** the derived key lives only in Rust-side
  memory, is zeroed on drop (`zeroize`), and is never exposed to the
  webview. Renderer code calls IPC commands that operate on opaque
  record IDs.
- **Legacy compatibility.** Vaults created by previous builds that used
  CryptoJS-style PBKDF2 + AES are still readable via the compatibility
  decrypt path shipped in epic `t3-e17`. On first successful decrypt
  the record is transparently re-sealed with the new Argon2id + GCM
  format; no user action is required.
- **bcryptjs rationale / migration.** Earlier builds used `bcryptjs` in
  the renderer to derive a wrapping key. bcryptjs is constant-factor
  bcrypt in JavaScript — it is CPU-bound, lacks memory hardness, and
  cannot benefit from native SIMD. Epic `t3-e40` replaced it with
  Argon2id executed in Rust, which provides memory hardness, native
  performance, and moves the primitive off the JS heap (where GC makes
  zeroization unreliable).

## 6. Updater & Publisher-Key Pinning

The Tauri updater verifies every update bundle against a public key
**embedded at build time** in `src-tauri/tauri.conf.json` (`pubkey`
field), delivered via epic `t3-e21`.

- The public key is pinned; the updater will refuse artifacts signed by
  any other key, even if TLS succeeds.
- The private key is held offline by the release team in an HSM-backed
  store. It never touches CI runners.
- **Rotation procedure:**
  1. Generate a new keypair offline (`tauri signer generate`).
  2. Ship a transition release that embeds **both** the old and new
     public keys and is signed with the old key.
  3. After the transition release reaches steady-state adoption, ship a
     release signed with the new key and embedding only the new key.
  4. Publish the new fingerprint in release notes and on the security
     contact page.
  5. Destroy the old private key material.
- Compromise of the signing key is treated as a P0 incident and
  triggers an out-of-band advisory via the reporting channel above.

## 7. Code Signing

Release binaries are signed on both supported desktop platforms:

- **Windows (epic `t3-e36`)**: signed with a DigiCert **EV Code Signing**
  certificate held in DigiCert KeyLocker (cloud HSM). Signing runs in a
  hardened CI job whose credentials are restricted to the release
  workflow and audited. EV provides instant SmartScreen reputation.
- **macOS (epic `t3-e37`)**: signed with an Apple **Developer ID
  Application** certificate, hardened-runtime enabled, and **notarized**
  via `notarytool`. Notarization tickets are stapled to the `.dmg` and
  `.app` before publication so Gatekeeper succeeds offline.
- Signatures are verified as part of the release smoke test before
  artifacts are promoted to the public update feed.

Users can verify signatures manually: `signtool verify /pa` on Windows,
`codesign --verify --deep --strict` and `spctl -a -vvv` on macOS.

## 8. Capability Scoping & Tauri Sandbox Posture

The Tauri v2 capability files under `src-tauri/capabilities/` follow a
least-privilege model (epic `t3-e16`):

- **No recursive filesystem access.** `fs:allow-*-recursive` permissions
  are explicitly absent. All file operations are constrained to
  enumerated scopes.
- **Filesystem scopes** are restricted to:
  - `$APPDATA/sortofremoteng/**` — the application's own config, vault,
    and logs.
  - `$DOWNLOAD/**` — used only for explicit user-initiated export /
    session-recording exports.
- **Shell / process** capabilities are allowlisted per protocol plugin
  (e.g., spawning the bundled `vpnclient` for SoftEther) and never
  expose a generic `shell:execute`.
- **Network** capabilities (`http:default`) are scoped to the origins
  required by the updater and telemetry; ad-hoc `fetch()` from renderer
  code is denied.
- **CSP.** The webview runs with a strict Content Security Policy (no
  inline scripts, no remote script origins). The Tauri runtime isolates
  the webview from the host process; all privileged operations cross an
  IPC boundary and are validated Rust-side.
- **Isolation pattern.** Where the underlying OS supports it, the
  webview process runs with reduced privileges (sandboxed renderer on
  Windows, App Sandbox entitlements on macOS).

## 9. Dependency & Supply-Chain Hygiene

- `cargo-audit` and `npm audit` run in CI on every PR; advisories
  gating the build are triaged within the same SLA as reported
  vulnerabilities.
- Lockfiles (`Cargo.lock`, `package-lock.json`, `bun.lock`) are
  committed; floating versions are not permitted for security-relevant
  crates (crypto, TLS, updater).
- Release tags are signed; CI verifies the tag signature before
  building release artifacts.

## 10. Hardening Roadmap

Tracked in `.orchestration/plans/t3.md`. Near-term items include
full-disk-encryption guidance for the vault directory, optional YubiKey
unlock for the master key, and transitioning the updater feed to a
transparency log.

---

*Last reviewed: 2026-04-20.*
