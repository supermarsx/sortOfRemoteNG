---
title: Releases
eyebrow: Project guide
description: Understand rolling version identity, signed updater artifacts, platform bundles, private feeds, and signing prerequisites.
permalink: /releases/
---

Public releases use a rolling `YY.N` identity, while package ecosystems and updater metadata receive the SemVer projection `YY.N.0`. Every successful `main` push queues a release only after all required checks pass for that exact source commit.

## Version representations

| Surface                          | Example  | Purpose                                            |
| -------------------------------- | -------- | -------------------------------------------------- |
| Public version and release title | `26.1`   | Human-facing UTC-year sequence                     |
| Git tag                          | `26.1`   | Immutable release-snapshot identity; no `v` prefix |
| Package / updater version        | `26.1.0` | Machine-compatible SemVer projection               |

`YY` is the two-digit UTC year. `N` is allocated monotonically from the existing bare tags and resets to 1 when the UTC year changes. The first current release is `26.1`. The allocator owns this public identity; it synchronizes `version.json` and every machine projection in the release snapshot rather than accepting unrelated version strings from separate jobs.

The workflow records the successful `main` commit as the release `source_sha`.
Its immutable bare tag identifies a detached, version-synchronized snapshot
commit whose `Release-Source-SHA` trailer maps back to that source. Builds
checkout the snapshot, while release notes and recovery retain the original
main-commit identity. A rerun for the same `source_sha` must reuse the reserved
tag and existing GitHub Release; it must not allocate another `N`.

## Release path

1. Run the normal CI jobs and the exact-source `Audit`, `Backend Coverage`, `Frontend Build`, and `Docker e2e (nightly)` gates.
2. Queue the successful `main` source commit, allocate or recover its bare `YY.N` tag, and synchronize the release snapshot.
3. Build Windows x64, Linux x64, macOS Intel, and macOS Apple Silicon bundles.
4. Publish the public OS installers. Missing optional Apple or Windows certificates leaves them truthfully OS-unsigned and may produce platform warnings; it does not suppress the release.
5. When `TAURI_SIGNING_PRIVATE_KEY` is configured, generate and validate signed updater artifacts for `windows-x86_64`, `linux-x86_64`, `darwin-x86_64`, and `darwin-aarch64`.
6. Publish and promote `latest.json` only after every referenced updater artifact and signature is present and verifiable. Without the updater key, omit updater signatures and `latest.json` while retaining the public installers.

<div class="callout callout--danger">
  <strong>Never commit the updater private key.</strong>
  <p>The embedded public key is repository configuration. The private key and its password belong only in the release secret store and the maintainers’ controlled backup.</p>
</div>

## Detailed runbooks

- [Updater signing and public-feed setup]({{ '/release/updater-setup/' | relative_url }}) covers key storage, feed schema, signature validation, and rotation.
- [Private updater endpoint]({{ '/release/private-updater-endpoint/' | relative_url }}) describes the Settings-managed private endpoint and fallback policy.
- [Apple Developer enrollment]({{ '/release/apple-developer-enrollment/' | relative_url }}) tracks macOS signing and notarization prerequisites.
- [Windows EV certificate]({{ '/release/windows-ev-cert/' | relative_url }}) tracks Authenticode/SmartScreen signing prerequisites.

OS-level code signing and updater signing solve different problems. Unsigned public bundles may prompt platform warnings. A release has an automatic-update channel only when its updater artifacts are signed with the protected Tauri key and a validated `latest.json` is published.

## Recovery and rollback

Normal releases are automatic. If a run stops before reserving its identity,
rerun the failed CI workflow or manually dispatch with the same `source_sha`,
`mode: rolling`, and `release_tier`. If its tag already exists, dispatch with
`mode: existing`, the same `source_sha` and `release_tier`, and that exact bare
`tag`. Recovery is idempotent: it resumes or updates the same release. Never
force-move, delete, or reuse a rolling tag for another commit.

Do not promote an older tag as a downgrade. If a published release is bad, stop promoting its updater feed where possible and ship the next `YY.N` as a forward fix signed with the same updater key. Clients that already installed the bad build cannot be safely rolled back by retagging.

Before manual recovery, verify that the source SHA is the intended successful `main` commit and inspect the workflow’s artifact validation output. Do not manually edit a generated updater feed to make a failing validation step pass.

```powershell
npm run version:test
npm run version:check
npm run release:test
```

Security-sensitive release changes should be reviewed against [Security]({{ '/security-overview/' | relative_url }}) and the signing runbooks above.
