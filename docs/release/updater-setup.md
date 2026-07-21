---
title: Tauri updater signing and feed setup
description: Signing-key custody, feed schema, publication, validation, and rotation for Tauri updater artifacts.
permalink: /release/updater-setup/
hide_page_header: true
---

# Tauri Updater — Signing & Feed Setup

This document covers the **Tauri updater plugin** wiring for
`sortOfRemoteNG`: how the Ed25519 signing keypair is generated, where the
private key must live, and the JSON schema of the optional `latest.json`
feed that our GitHub Releases publisher produces when updater signing is
configured.

The production updater path is intentionally narrow: the signed
`tauri-plugin-updater` runtime verifies and installs artifacts, and the
application exposes it through the backend-owned `updater_*` commands in
`sorng-updater`. Frontend code must call those commands through
`src/hooks/updater/useUpdater.ts`; it must not call
`@tauri-apps/plugin-updater` directly.

The old custom downloader, copy installer, scheduler, channel, history, and
rollback paths are not production update mechanisms. P1 installs are signed
Tauri updater installs only. Private feed configuration is managed by
Settings > Updater and documented in
[private updater endpoint guide]({{ '/release/private-updater-endpoint/' | relative_url }}).

Public OS installers and updater delivery are separate release outputs. Every
successful `main` push may publish Windows, Linux, and macOS installers without
OS-signing certificates. The workflow publishes updater archives, signatures,
and `latest.json` only when `TAURI_SIGNING_PRIVATE_KEY` is configured; it never
advertises an unsigned artifact to the updater.

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

| Location                                                                               | Purpose                                                                                                                                                                                         | Access                                   |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **1Password vault: `sortOfRemoteNG / Release signing`**                                | Canonical master copy. Holds `sortofremoteng.key`, the password used at generation time, and a dated rotation log entry.                                                                        | Release maintainers only.                |
| **GitHub secret `TAURI_SIGNING_PRIVATE_KEY`** (+ `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) | Consumed by the release CI workflow (`tauri-action`). Paste the **entire** `*.key` file contents including the `untrusted comment:` header line.                                                | Repository admins; rotates by overwrite. |
| Developer workstation at `~/.tauri/sortofremoteng.key`                                 | _Optional._ Only for maintainers running signed local builds. Must be 0600 / ACL-restricted. Not required for normal development — `tauri dev` and unsigned `tauri build` both work without it. | Individual maintainer.                   |

The repository's `.gitignore` contains the patterns `.keys/`, `*.key`,
`*.key.pub` to stop accidental commits of either half of the keypair.
**The public `*.key.pub` file is also gitignored** — we commit the pubkey
_inline_ in `tauri.conf.json`, never as a loose file, so that a single
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

The GitHub release workflow (`.github/workflows/release.yml`) consumes these
environment variables when invoking `tauri-apps/tauri-action`:

| Env var                              | Required                                    | Notes                                                                             |
| ------------------------------------ | ------------------------------------------- | --------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | for updater artifacts and `latest.json`     | Full contents of `sortofremoteng.key`, including the `untrusted comment:` header. |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | when that private key is password-protected | Plaintext password; store it as a protected secret.                               |

No other updater-specific secrets are required — the pubkey is embedded at
build time from `tauri.conf.json`. Apple Developer ID/notarization credentials
and Windows Authenticode credentials are optional OS-signing inputs described
in the linked platform runbooks. Their absence must not block publication of
public installers.

Release identity has two deliberate representations:

- Bare Git tags and GitHub Release names use rolling `YY.N` (`26.1`) with no
  prefix.
- `YY` is the two-digit UTC year and `N` is that year's monotonically
  increasing counter. The counter starts at 1 after each UTC year rollover;
  the first current release is `26.1`.
- Package manifests, bundle filenames, and updater feeds use the machine-only
  SemVer projection `YY.N.0` (`26.1.0`).
- `version.json` and the other projections are synchronized in an immutable,
  detached release snapshot. Its `Release-Source-SHA` commit trailer records
  the successful `main` source commit.

Every successful push to `main` queues this workflow only after the CI-internal
jobs and the exact-source `Audit`, `Backend Coverage`, `Frontend Build`, and
`Docker e2e (nightly)` workflows pass. The workflow receives that commit as
`source_sha`, atomically allocates or recovers its bare tag, derives `YY.N.0`,
and runs the version checks against the prepared snapshot. A rerun for the same
source SHA reuses its tag and GitHub Release rather than incrementing `N`.

The four updater targets are `windows-x86_64`, `linux-x86_64`,
`darwin-x86_64`, and `darwin-aarch64`. If the Tauri private key is absent, the
workflow omits their updater signatures and `latest.json` but may still publish
the corresponding public OS installers. If the key is present, missing or
invalid updater artifacts fail publication of the feed.

---

## 3. Feed URL and runtime endpoint policy

The committed public endpoint in `tauri.conf.json` is:

```json
"endpoints": [
  "https://github.com/supermarsx/sortOfRemoteNG/releases/latest/download/latest.json"
]
```

GitHub serves `latest/download/<asset>` as a 302 redirect to the most recent
release's asset with that filename, so publishing a signed release with a
`latest.json` asset is sufficient to promote it — no edits to the committed
endpoint list are required per release. An OS-installer-only release omits
`latest.json`; that release is downloadable from GitHub but is not advertised
as an automatic in-app update.

At runtime, `sorng-updater` may prepend a Settings-managed private endpoint
by constructing a plugin updater with `updater_builder().endpoints(..)`. The
same embedded pubkey verifies both private and public artifacts. The legacy
`UPDATER_PRIVATE_ENDPOINT_URL` build-time env var is ignored and should not
be used for production configuration.

---

## 4. `latest.json` schema

The updater expects a JSON document of the following shape (this is the
standard Tauri v2 schema; see the
[Tauri updater docs](https://v2.tauri.app/plugin/updater/) for the
upstream reference). The file must be a release asset named exactly
`latest.json` and must sign the **installer artifacts**, not itself.
The feed's `version` is always the machine projection (`YY.N.0`), while its
release URL and human-facing notes retain the bare public tag/version (`YY.N`).

```jsonc
{
  "version": "26.1.0", // machine SemVer; must be > the running app's version
  "notes": "Release 26.1",
  "pub_date": "2026-04-20T00:00:00Z", // RFC 3339 / ISO 8601
  "platforms": {
    "windows-x86_64": {
      "signature": "<base64 minisign signature of the .msi/.exe artifact>",
      "url": "https://github.com/supermarsx/sortOfRemoteNG/releases/download/26.1/sortOfRemoteNG_26.1.0_x64_en-US.msi",
    },
    "darwin-x86_64": {
      "signature": "<base64 minisign signature of the .app.tar.gz artifact>",
      "url": "https://github.com/supermarsx/sortOfRemoteNG/releases/download/26.1/sortOfRemoteNG_x64.app.tar.gz",
    },
    "darwin-aarch64": {
      "signature": "<base64 minisign signature>",
      "url": "https://github.com/supermarsx/sortOfRemoteNG/releases/download/26.1/sortOfRemoteNG_aarch64.app.tar.gz",
    },
    "linux-x86_64": {
      "signature": "<base64 minisign signature of the .AppImage artifact>",
      "url": "https://github.com/supermarsx/sortOfRemoteNG/releases/download/26.1/sortOfRemoteNG_26.1.0_amd64.AppImage",
    },
  },
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

The release workflow owns the generator that emits this file from the
`tauri build` output. `scripts/ci/validate-updater-feed.mjs` enforces the
schema, platform entries, artifact URLs, and signatures before a feed can be
published. It also requires valid SemVer transport metadata and the exact
expected machine projection supplied by the release workflow.

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
cargo check -p sorng-updater
cargo check -p sorng-commands-core -p sorng-commands-tools
cargo check -p app                # embeds pubkey at compile time
npm run lint && npm run test      # covers the Settings updater UI and command facade
node scripts/ci/validate-updater-feed.mjs <latest.json> --expected-version 26.1.0
npm run tauri:build               # produces signed bundle if env vars set
```

A bundle built **without** `TAURI_SIGNING_PRIVATE_KEY` in the environment
will still compile but will not emit updater `.sig` files — that is
intentional so day-to-day local builds and public OS-installer releases do not
require the secret. Do not construct or upload `latest.json` for those bundles.

---

## 7. Rerun, recovery, and bad-release policy

Normal releases are driven by successful `main` CI. If a run stops before
reserving its identity, rerun the failed CI job or manually dispatch with the
same `source_sha`, `mode: rolling`, and `release_tier`. If its tag already
exists, dispatch with `mode: existing`, the same `source_sha` and
`release_tier`, and that exact bare `tag`. The workflow must reuse and complete
that release idempotently.

Rolling tags are immutable evidence. Never force-move, delete, or reuse one for
another source commit. If a release is bad, do not repoint its tag or edit its
generated feed to impersonate another version. Remove it from updater
promotion where practical and publish the next `YY.N` as a forward fix signed
with the same updater key. Clients that already installed the bad build cannot
be safely downgraded through the normal version-monotonic updater.
