# Private Updater Endpoint — Enterprise Deployment Guide (t3-e39)

This document covers the **pluggable private update feed** that supplements
the public GitHub Releases feed wired in
[`updater-setup.md`](./updater-setup.md). It lets an enterprise admin
distribute signed updates from a private HTTPS endpoint (typically an S3
bucket behind CloudFront, or any TLS-terminated static host) while
keeping the public feed available as a fallback.

**Signature verification parity:** both endpoints are verified against
the **same** embedded Ed25519 pubkey (`plugins.updater.pubkey` in
`tauri.conf.json`). The private feed does NOT ship its own keypair; the
release maintainer signs the same installer artifacts and uploads the
matching `.sig` values to `latest.json` on the private bucket, exactly
as for the public feed. If you rotate the pubkey, follow the bridge-
release procedure in `updater-setup.md` § 5 — both feeds must continue
to serve artifacts signed by the current private key.

---

## 1. How the two endpoints are combined

Tauri's updater plugin queries endpoints **in order** and uses the first
that returns a valid `latest.json`. `sortOfRemoteNG` composes the list
from three sources, in priority:

1. Runtime setting (`<AppData>/settings.json` → `updater.private_endpoint`)
   — if present, the Rust runtime augments the plugin's list via
   `UpdaterExt::updater_builder().endpoints(..)`.
2. Build-time env var `UPDATER_PRIVATE_ENDPOINT_URL` — baked into
   `tauri.conf.json`'s `plugins.updater.endpoints` by `src-tauri/build.rs`
   during `tauri build`.
3. Public GitHub Releases (always present, first entry in the committed
   `tauri.conf.json`).

A build with either (1) or (2) set therefore checks the private endpoint
first, falling back to public automatically if the private host is
unreachable or the published `latest.json` there is older.

---

## 2. Enable at build time (recommended for enterprise CI)

Set the env var before `tauri build`:

```sh
export UPDATER_PRIVATE_ENDPOINT_URL="https://updates.corp.example.com/sortofremoteng/latest.json"
npm run tauri:build
```

`src-tauri/build.rs` reads the variable, validates it starts with
`http(s)://`, and appends it to `plugins.updater.endpoints` in
`tauri.conf.json`. The mutation is idempotent (re-running with the same
URL is a no-op) but **is a real file edit on disk** — run the build in a
fresh / throwaway checkout and do NOT commit the resulting diff.

CI example (GitHub Actions):

```yaml
- name: Build signed enterprise bundle
  env:
    UPDATER_PRIVATE_ENDPOINT_URL: ${{ secrets.PRIVATE_UPDATE_FEED_URL }}
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
  run: npm ci && npm run tauri:build
```

---

## 3. Enable at runtime (MDM / user override)

For already-installed clients, push a settings file to each machine:

**Windows:** `%APPDATA%\com.sortofremote.ng\settings.json`
**macOS:** `~/Library/Application Support/com.sortofremote.ng/settings.json`
**Linux:** `~/.config/com.sortofremote.ng/settings.json`

Contents (merges with any existing keys — Intune / Jamf / Ansible etc.
should preserve other top-level entries):

```json
{
  "updater": {
    "private_endpoint": "https://updates.corp.example.com/sortofremoteng/latest.json"
  }
}
```

The app reads this key via
[`src-tauri/src/updater_config.rs::read_private_endpoint`](../../src-tauri/src/updater_config.rs)
on demand. End users can also set/clear the value themselves through the
optional settings pane backed by
`src/components/settings/UpdaterEndpointSetting.tsx`.

Invalid URLs (non-`http(s)://`) are silently ignored — the plugin falls
back to the public endpoint alone. The app NEVER allows a private
endpoint to override the embedded pubkey; signature verification always
uses the committed key.

---

## 4. S3 bucket layout

A minimal layout that works out of the box with the Tauri updater:

```
s3://sortofremoteng-updates/
├── latest.json                                      (public-read)
├── 0.1.1/
│   ├── sortOfRemoteNG_0.1.1_x64_en-US.msi           (public-read)
│   ├── sortOfRemoteNG_0.1.1_x64_en-US.msi.sig       (public-read)
│   ├── sortOfRemoteNG_0.1.1_x64.app.tar.gz
│   ├── sortOfRemoteNG_0.1.1_x64.app.tar.gz.sig
│   ├── sortOfRemoteNG_0.1.1_aarch64.app.tar.gz
│   ├── sortOfRemoteNG_0.1.1_aarch64.app.tar.gz.sig
│   ├── sortOfRemoteNG_0.1.1_amd64.AppImage
│   └── sortOfRemoteNG_0.1.1_amd64.AppImage.sig
└── 0.1.2/…
```

**Conventions:**

- `latest.json` is always at the bucket root and overwritten on each
  release (cache-control `max-age=60` so the CDN picks up new releases
  within a minute).
- Installer + `.sig` file names match the `tauri build` output exactly;
  renaming breaks the embedded signature check.
- The bucket is fronted by **CloudFront** (or your CDN of choice) with
  ACM-issued TLS. Origin access is typically **OAI / OAC** so only the
  CDN can read — clients only ever talk to the CDN hostname.
- The URL you bake into `UPDATER_PRIVATE_ENDPOINT_URL` is the CDN
  hostname + `/latest.json`, e.g.
  `https://updates.corp.example.com/sortofremoteng/latest.json`.

---

## 5. `latest.json` schema (identical to the public feed)

```jsonc
{
  "version": "0.1.1",
  "notes": "Enterprise build; release notes here.",
  "pub_date": "2026-04-20T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<base64 minisign signature of the .msi artifact>",
      "url": "https://updates.corp.example.com/sortofremoteng/0.1.1/sortOfRemoteNG_0.1.1_x64_en-US.msi"
    },
    "darwin-x86_64": {
      "signature": "<base64 minisign signature>",
      "url": "https://updates.corp.example.com/sortofremoteng/0.1.1/sortOfRemoteNG_0.1.1_x64.app.tar.gz"
    },
    "darwin-aarch64": {
      "signature": "<base64 minisign signature>",
      "url": "https://updates.corp.example.com/sortofremoteng/0.1.1/sortOfRemoteNG_0.1.1_aarch64.app.tar.gz"
    },
    "linux-x86_64": {
      "signature": "<base64 minisign signature>",
      "url": "https://updates.corp.example.com/sortofremoteng/0.1.1/sortOfRemoteNG_0.1.1_amd64.AppImage"
    }
  }
}
```

The `signature` values are the **same** ones you'd publish on the public
GitHub release — both feeds point at different URLs but the bytes at
those URLs are byte-identical (or at least both signed by the same
private key).

---

## 6. IAM policy example

Two principals typically need access to the bucket:

### 6.1 CI / release publisher (write)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublishReleaseAssets",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:AbortMultipartUpload",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": [
        "arn:aws:s3:::sortofremoteng-updates/latest.json",
        "arn:aws:s3:::sortofremoteng-updates/*/*"
      ]
    },
    {
      "Sid": "InvalidateCdnCache",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": "arn:aws:cloudfront::<ACCOUNT>:distribution/<DIST_ID>"
    }
  ]
}
```

Attach this policy to the IAM role assumed by the release CI workflow
(e.g. via OIDC federation from GitHub Actions). Never use long-lived
access keys.

### 6.2 CloudFront origin access (read)

Use an **Origin Access Control** (OAC) on the CloudFront distribution;
the bucket policy then allows `s3:GetObject` only from that OAC:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudFrontReadOnly",
      "Effect": "Allow",
      "Principal": { "Service": "cloudfront.amazonaws.com" },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::sortofremoteng-updates/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::<ACCOUNT>:distribution/<DIST_ID>"
        }
      }
    }
  ]
}
```

Block all public access at the bucket level (`BlockPublicPolicy`,
`IgnorePublicAcls`, `BlockPublicAcls`, `RestrictPublicBuckets` = true).

---

## 7. Deploy steps — release maintainer runbook

1. **Build** the bundle with signing env vars set (see
   [`updater-setup.md`](./updater-setup.md) § 2). `tauri build` emits
   installers + `.sig` files under `src-tauri/target/release/bundle/`.
2. **Assemble `latest.json`** with the base64 `.sig` values and the
   CloudFront URLs for each platform (see § 5 above). The release CI
   job (`t3-e22`) has a generator script; for ad-hoc builds, do it by
   hand.
3. **Upload to S3** (versioned dir + root `latest.json`):
   ```sh
   aws s3 cp src-tauri/target/release/bundle/ \
     s3://sortofremoteng-updates/0.1.1/ --recursive \
     --exclude "*" --include "*.msi" --include "*.msi.sig" \
     --include "*.tar.gz" --include "*.tar.gz.sig" \
     --include "*.AppImage" --include "*.AppImage.sig"
   aws s3 cp latest.json s3://sortofremoteng-updates/latest.json \
     --cache-control "max-age=60"
   ```
4. **Invalidate the CDN** for `/latest.json`:
   ```sh
   aws cloudfront create-invalidation \
     --distribution-id <DIST_ID> --paths "/latest.json"
   ```
5. **Smoke-test** on a staging workstation with the private endpoint
   configured: launch the app, hit the "Check for updates" button
   (backed by `CheckForUpdatesButton.tsx`), confirm the new version is
   reported and the downloaded bundle verifies against the embedded
   pubkey.
6. **Promote** by publishing the matching GitHub release with the same
   signed artifacts + `latest.json` so public-feed users receive the
   same update.

---

## 8. Roll-back

If a release is bad, overwrite `latest.json` at the bucket root with the
previous release's manifest and invalidate the CDN. Clients that have
NOT yet installed the bad version will simply see the prior version
again. Clients that already upgraded use the in-app updater's
rollback UI (`src/components/updater/UpdaterPanel.tsx`), backed by the
app's own `updater_*` backend commands — this path is independent of
the endpoint configuration.

---

## 9. Security notes

- **TLS-only**: `https://` is required in practice. `http://` is
  accepted by the build-script / runtime parser for corp intranet lab
  use only. Do not deploy an `http://` endpoint to real users — the
  signature check still protects the payload, but metadata
  (release cadence, version numbers, user IPs) is sent in cleartext.
- **Pubkey never changes per-endpoint.** If the private feed needs a
  different trust anchor, that is a new app build — both feeds must
  sign against whatever key is embedded.
- **Settings file is plaintext.** The private endpoint URL is not a
  secret (its hostname is visible on the wire anyway); if you need the
  URL to be confidential, gate access at the CDN / VPN / firewall layer
  rather than encrypting the settings file.
- **Windows note**: `%APPDATA%` resolves to `C:\Users\<user>\AppData\Roaming`.
  MDM pushes should target that path per user, or use the
  `UPDATER_PRIVATE_ENDPOINT_URL` build-time path for machine-wide
  deployments.
