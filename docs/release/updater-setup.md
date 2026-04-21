# Tauri Updater — Signing & Feed Setup (t3-e21)

This document covers the **Tauri updater plugin** wiring for
`sortOfRemoteNG`: how the Ed25519 signing keypair is generated, where the
private key must live, and the JSON schema of the `latest.json` feed that
our GitHub Releases publisher produces.

The updater plugin referenced here is the low-level signed-artifact
delivery layer (`tauri-plugin-updater` / `@tauri-apps/plugin-updater`). It
sits **alongside** the higher-level in-app updater UI
(`src/components/updater/UpdaterPanel.tsx`), which talks to the app's own
`updater_*` backend commands for channel switching, history and rollback.

> **Pluggable private-endpoint variant:** the dual-feed / private S3
> endpoint support (user decision Q6) is scoped to executor **t3-e39** and
> documented separately in
> [`private-updater-endpoint.md`](./private-updater-endpoint.md) once that
> executor lands. `t3-e21` ships only the public GitHub Releases feed.

---

## 1. Pubkey (committed) / Privkey (never committed)

**Public key** — inline in `src-tauri/tauri.conf.json` under
`plugins.updater.pubkey`. This is the base64-wrapped minisign public key
embedded into every build so that the runtime updater can verify the
signature of any downloaded update artifact. Rotating it requires a
coordinated release (see §5).

The current committed pubkey:

```
dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDMwNDBGMTM2QTFFRUU2RDQKUldUVTV1NmhOdkZBTUpMeUFxYXNzMHdBRi9PemFUOUludnVYUHFpTTJVVXAyRGN4TUdJMmlhYjQK
```

**Private key** — must never be committed. It is generated via
`tauri signer generate -w <path>` (minisign-format Ed25519) and lives in
exactly two places, with a third (developer workstation) as an opt-in for
local signed-build testing.

| Location | Purpose | Access |
| --- | --- | --- |
| **1Password vault: `sortOfRemoteNG / Release signing`** | Canonical master copy. Holds `sortofremoteng.key`, the password used at generation time, and a dated rotation log entry. | Release maintainers only. |
| **GitHub secret `TAURI_SIGNING_PRIVATE_KEY`** (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) | Consumed by the release CI workflow (`tauri-action`). Paste the **entire** `*.key` file contents including the `untrusted comment:` header line. | Repository admins; rotates by overwrite. |
| Developer workstation at `~/.tauri/sortofremoteng.key` | *Optional.* Only for maintainers running signed local builds. Must be 0600 / ACL-restricted. Not required for normal development — `tauri dev` and unsigned `tauri build` both work without it. | Individual maintainer. |

The repository's `.gitignore` contains the patterns `.keys/`, `*.key`,
`*.key.pub` to stop accidental commits of either half of the keypair.
**The public `*.key.pub` file is also gitignored** — we commit the pubkey
*inline* in `tauri.conf.json`, never as a loose file, so that a single
well-reviewed location is the source of truth.

### Regenerating the keypair (bootstrap / one-time)

```sh
npx tauri signer generate -w ~/.tauri/sortofremoteng.key
# Follow prompts; choose a strong password; record it in 1Password.
```

Then:

1. Copy `~/.tauri/sortofremoteng.key.pub` contents (single base64 blob).
2. Paste it into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
3. Paste `~/.tauri/sortofremoteng.key` contents into the GitHub secret
   `TAURI_SIGNING_PRIVATE_KEY`. If you set a password, also set
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
4. File a 1Password vault entry and delete the workstation file once the
   GitHub secret is confirmed working (or keep it for local signed-build
   testing — see table above).

---

## 2. CI signing env vars

The GitHub release workflow (`.github/workflows/release.yml`, produced by
executor t3-e22) consumes these env vars when invoking
`tauri-apps/tauri-action`:

| Env var | Required | Notes |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | **yes** | Full contents of `sortofremoteng.key`, including the `untrusted comment:` header. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | if password-protected | Plaintext password; mark as a secret. |

No other updater-specific secrets are required — the pubkey is embedded
at build time from `tauri.conf.json`.

---

## 3. Feed URL

The committed endpoint list in `tauri.conf.json` is:

```json
"endpoints": [
  "https://github.com/supermarsx/sortOfRemoteNG/releases/latest/download/latest.json"
]
```

GitHub serves `latest/download/<asset>` as a 302 redirect to the most
recent release's asset with that filename, so publishing a release with a
`latest.json` asset is sufficient to promote it — no edits to the
committed endpoint list are required per-release.

---

## 4. `latest.json` schema

The updater expects a JSON document of the following shape (this is the
standard Tauri v2 schema; see the
[Tauri updater docs](https://v2.tauri.app/plugin/updater/) for the
upstream reference). The file must be a release asset named exactly
`latest.json` and must sign the **installer artifacts**, not itself.

```jsonc
{
  "version": "0.1.1",                 // semver; must be > the running app's version
  "notes": "Release notes text or markdown.",
  "pub_date": "2026-04-20T00:00:00Z", // RFC 3339 / ISO 8601
  "platforms": {
    "windows-x86_64": {
      "signature": "<base64 minisign signature of the .msi/.exe artifact>",
      "url": "https://github.com/supermarsx/sortOfRemoteNG/releases/download/v0.1.1/sortOfRemoteNG_0.1.1_x64_en-US.msi"
    },
    "darwin-x86_64": {
      "signature": "<base64 minisign signature of the .app.tar.gz artifact>",
      "url": "https://github.com/supermarsx/sortOfRemoteNG/releases/download/v0.1.1/sortOfRemoteNG_x64.app.tar.gz"
    },
    "darwin-aarch64": {
      "signature": "<base64 minisign signature>",
      "url": "https://github.com/supermarsx/sortOfRemoteNG/releases/download/v0.1.1/sortOfRemoteNG_aarch64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "<base64 minisign signature of the .AppImage artifact>",
      "url": "https://github.com/supermarsx/sortOfRemoteNG/releases/download/v0.1.1/sortOfRemoteNG_0.1.1_amd64.AppImage"
    }
  }
}
```

Platform identifier rules (per Tauri v2):

- `<os>-<arch>` where `os ∈ {windows, darwin, linux}` and
  `arch ∈ {x86_64, aarch64, i686, armv7}`.
- The `signature` field is the base64 contents of the `.sig` file that
  `tauri build` emits next to the bundle (NOT the bundle hash).
- The `url` MUST resolve over HTTPS to the same artifact that was signed.
- `pub_date` is optional for the runtime but required by our release CI
  for audit purposes.

Executor **t3-e22** owns the actual generator that emits this file from
the `tauri build` output; t3-e21 just documents the shape.

---

## 5. Key rotation

Rotating the keypair is a **breaking change for already-installed
clients**: an installed build with pubkey A cannot verify an update
signed by private key B, so a rotation requires at minimum one "bridge"
release signed by the old key that ships the new pubkey, followed by
releases signed with the new key.

Procedure:

1. Generate a new keypair (`tauri signer generate`) and store in 1Password
   under a new entry (`sortOfRemoteNG / Release signing (YYYY-MM)`).
2. Ship release **N** signed with the **old** key; it only changes
   `plugins.updater.pubkey` in `tauri.conf.json` to the new pubkey.
   Clients on version ≤ N-1 verify N with the old pubkey, install it, and
   thereafter hold the new pubkey.
3. Ship release **N+1** signed with the **new** key; update the GitHub
   secret `TAURI_SIGNING_PRIVATE_KEY` to the new private key.
4. Retire the old entry in 1Password (keep archived, do not delete — may
   be needed to forensically verify historical releases).

If the old private key is compromised, skip step 2 and publish an
out-of-band advisory instructing affected users to reinstall from a
trusted channel; there is no way to forcibly re-key an installed client
whose embedded pubkey you can no longer sign for.

---

## 6. Local verification

To confirm the plugin is wired correctly after any change to this setup:

```sh
cargo check -p app                # embeds pubkey at compile time
npm run lint && npm run test      # lints the CheckForUpdatesButton shim
npm run tauri:build               # produces signed bundle if env vars set
```

A bundle built **without** `TAURI_SIGNING_PRIVATE_KEY` in the environment
will still compile but will not emit `.sig` files — that is intentional
so day-to-day local builds don't require the secret.
