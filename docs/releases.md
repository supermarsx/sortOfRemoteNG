---
title: Releases
eyebrow: Project guide
description: Understand rolling version identity, signed updater artifacts, platform bundles, private feeds, and signing prerequisites.
permalink: /releases/
---

Public releases use a rolling `YY.N` identity, while package ecosystems and updater metadata receive the SemVer projection `YY.N.0`. The repository’s `version.json` is the source of truth, and CI checks every projection before release work proceeds.

## Version representations

| Surface                          | Example  | Purpose                                       |
| -------------------------------- | -------- | --------------------------------------------- |
| Public version and release title | `26.1`   | Human-facing yearly sequence                  |
| Git tag                          | `v26.1`  | Immutable release trigger and source identity |
| Package / updater version        | `26.1.0` | Machine-compatible SemVer projection          |

A release tag must match `version.json`; the workflow derives the machine projection rather than accepting unrelated version strings from separate jobs.

## Release path

1. Synchronize and verify version projections.
2. Build platform bundles in the release workflow.
3. Sign updater-capable artifacts with the protected Tauri signing key.
4. Validate filenames, signatures, platform entries, URLs, and `latest.json`.
5. Publish the immutable GitHub Release assets.
6. Promote the feed only after its referenced artifacts are present and verifiable.

<div class="callout callout--danger">
  <strong>Never commit the updater private key.</strong>
  <p>The embedded public key is repository configuration. The private key and its password belong only in the release secret store and the maintainers’ controlled backup.</p>
</div>

## Detailed runbooks

- [Updater signing and public-feed setup]({{ '/release/updater-setup/' | relative_url }}) covers key storage, feed schema, signature validation, and rotation.
- [Private updater endpoint]({{ '/release/private-updater-endpoint/' | relative_url }}) describes the Settings-managed private endpoint and fallback policy.
- [Apple Developer enrollment]({{ '/release/apple-developer-enrollment/' | relative_url }}) tracks macOS signing and notarization prerequisites.
- [Windows EV certificate]({{ '/release/windows-ev-cert/' | relative_url }}) tracks Authenticode/SmartScreen signing prerequisites.

OS-level code signing and updater signing solve different problems. Unsigned public bundles may prompt platform warnings even when the updater can cryptographically verify update artifacts.

## Before publishing

Run the repository version and release tests, verify that the tagged commit is the intended source, and inspect the workflow’s artifact validation output. Do not manually edit a generated updater feed to make a failing validation step pass.

```powershell
npm run version:test
npm run version:check
npm run release:test
```

Security-sensitive release changes should be reviewed against [Security]({{ '/security-overview/' | relative_url }}) and the signing runbooks above.
