---
title: Private updater endpoint
description: Runtime policy for a Settings-managed private Tauri updater feed and public fallback.
permalink: /release/private-updater-endpoint/
hide_page_header: true
---

# Private Updater Endpoint — Enterprise Deployment Guide

This document covers the **Settings-managed private update feed** that
supplements the public GitHub Releases feed wired in
[updater setup guide]({{ '/release/updater-setup/' | relative_url }}). It lets an enterprise admin or
field-support user configure a private HTTPS endpoint (typically an S3 bucket
behind CloudFront, or any TLS-terminated static host) while keeping the public
feed available as a fallback.

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
that returns a valid `latest.json`. `sortOfRemoteNG` composes the runtime list
inside `sorng-updater`:

1. Settings-managed private endpoint (`settings.json` →
   `updater.privateEndpointEnabled` + `updater.privateEndpointUrl`), when
   enabled and valid.
2. Public GitHub Releases, always present:
   `https://github.com/supermarsx/sortOfRemoteNG/releases/latest/download/latest.json`.

The runtime uses `UpdaterExt::updater_builder().endpoints(..)` to pass the
resolved list to `tauri-plugin-updater`. A private endpoint therefore checks
first, falling back to public automatically if no private update is available.

---

## 2. Build-time endpoint configuration

Build-time private endpoint mutation is retired. `UPDATER_PRIVATE_ENDPOINT_URL`
is intentionally ignored by `src-tauri/build.rs`; production configuration
belongs in backend updater settings so it can be inspected and changed from
Settings > Updater without changing the signed app bundle.

---

## 3. Enable at runtime (Settings / MDM)

Users can configure the endpoint in **Settings > Updater**. MDM systems can
also push the same settings file to each machine:

**Windows:** `%APPDATA%\com.sortofremote.ng\settings.json`
**macOS:** `~/Library/Application Support/com.sortofremote.ng/settings.json`
**Linux:** `~/.config/com.sortofremote.ng/settings.json`

Contents (merges with any existing keys — Intune / Jamf / Ansible etc.
should preserve other top-level entries):

```json
{
  "updater": {
    "privateEndpointEnabled": true,
    "privateEndpointUrl": "https://updates.corp.example.com/sortofremoteng/latest.json"
  }
}
```

Legacy `updater.private_endpoint` is still read for migration, but new writes
use the camelCase keys above. Invalid production URLs are rejected by the
backend settings command; local debug HTTP is the only non-HTTPS exception.
The app never allows a private endpoint to override the embedded pubkey;
signature verification always uses the committed key.

---

## 4. S3 bucket layout

A minimal layout that works out of the box with the Tauri updater:

```
s3://sortofremoteng-updates/
├── latest.json                                      (public-read)
├── 26.1.0/
│   ├── sortOfRemoteNG_26.1.0_x64_en-US.msi           (public-read)
│   ├── sortOfRemoteNG_26.1.0_x64_en-US.msi.sig       (public-read)
│   ├── sortOfRemoteNG_26.1.0_x64.app.tar.gz
│   ├── sortOfRemoteNG_26.1.0_x64.app.tar.gz.sig
│   ├── sortOfRemoteNG_26.1.0_aarch64.app.tar.gz
│   ├── sortOfRemoteNG_26.1.0_aarch64.app.tar.gz.sig
│   ├── sortOfRemoteNG_26.1.0_amd64.AppImage
│   └── sortOfRemoteNG_26.1.0_amd64.AppImage.sig
└── 26.2.0/…
```

**Conventions:**

- `latest.json` is always at the bucket root and overwritten on each
  release (cache-control `max-age=60` so the CDN picks up new releases
  within a minute).
- Installer + `.sig` file names match the `tauri build` output exactly;
  renaming breaks the embedded signature check.
- Directory, artifact, and feed versions use machine SemVer `YY.N.0`. Public
  GitHub tags and release labels remain `vYY.N` and `YY.N`.
- The bucket is fronted by **CloudFront** (or your CDN of choice) with
  ACM-issued TLS. Origin access is typically **OAI / OAC** so only the
  CDN can read — clients only ever talk to the CDN hostname.
- The URL configured in Settings or managed settings is the CDN hostname plus
  `/latest.json`, e.g.
  `https://updates.corp.example.com/sortofremoteng/latest.json`.

---

## 5. `latest.json` schema (identical to the public feed)

```jsonc
{
  "version": "26.1.0",
  "notes": "Enterprise build for release 26.1.",
  "pub_date": "2026-04-20T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<base64 minisign signature of the .msi artifact>",
      "url": "https://updates.corp.example.com/sortofremoteng/26.1.0/sortOfRemoteNG_26.1.0_x64_en-US.msi",
    },
    "darwin-x86_64": {
      "signature": "<base64 minisign signature>",
      "url": "https://updates.corp.example.com/sortofremoteng/26.1.0/sortOfRemoteNG_26.1.0_x64.app.tar.gz",
    },
    "darwin-aarch64": {
      "signature": "<base64 minisign signature>",
      "url": "https://updates.corp.example.com/sortofremoteng/26.1.0/sortOfRemoteNG_26.1.0_aarch64.app.tar.gz",
    },
    "linux-x86_64": {
      "signature": "<base64 minisign signature>",
      "url": "https://updates.corp.example.com/sortofremoteng/26.1.0/sortOfRemoteNG_26.1.0_amd64.AppImage",
    },
  },
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
   [updater setup guide]({{ '/release/updater-setup/' | relative_url }}) § 2). `tauri build` emits
   installers + `.sig` files under `src-tauri/target/release/bundle/`.
2. **Assemble `latest.json`** with the base64 `.sig` values and the
   CloudFront URLs for each platform (see § 5 above). The release CI
   job (`t3-e22`) has a generator script; for ad-hoc builds, do it by
   hand.
3. **Upload to S3** (versioned dir + root `latest.json`):
   ```sh
   aws s3 cp src-tauri/target/release/bundle/ \
     s3://sortofremoteng-updates/26.1.0/ --recursive \
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
   configured in Settings > Updater: launch the app, check for updates,
   confirm the new version is reported, then run Download and install to
   verify the Tauri updater accepts the signed artifact.
6. **Promote** by publishing the matching GitHub release with the same
   signed artifacts + `latest.json` so public-feed users receive the
   same update.

---

## 8. Bad release handling

If a release is bad, overwrite `latest.json` at the bucket root with the
previous release's manifest and invalidate the CDN. Clients that have
NOT yet installed the bad version will simply see the prior version
again.

Clients that already installed the bad version must receive a forward fix
release signed with the same updater key. P1 does not provide an in-app
rollback installer, copy installer, or channel-history rollback command.

---

## 9. Security notes

- **TLS-only**: `https://` is required for production. Local debug HTTP is
  allowed only for development builds. Do not deploy an `http://` endpoint to
  real users — the signature check still protects the payload, but metadata
  (release cadence, version numbers, user IPs) is sent in cleartext.
- **Pubkey never changes per-endpoint.** If the private feed needs a
  different trust anchor, that is a new app build — both feeds must
  sign against whatever key is embedded.
- **Settings file is plaintext.** The private endpoint URL is not a
  secret (its hostname is visible on the wire anyway); if you need the
  URL to be confidential, gate access at the CDN / VPN / firewall layer
  rather than encrypting the settings file.
- **Windows note**: `%APPDATA%` resolves to `C:\Users\<user>\AppData\Roaming`.
  MDM pushes should target that path per user and preserve other settings keys;
  there is no build-time private-endpoint override.
