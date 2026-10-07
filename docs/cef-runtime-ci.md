---
title: Reusable patched CEF builds
eyebrow: Development
description: Separate engine CI, reviewed prebuilt downloads, and local browser SDK caching.
permalink: /cef-runtime-ci/
---

# Reusable patched CEF builds

The application consumes a **prebuilt patched engine**. It does not compile
Chromium as part of an ordinary `npm run tauri:dev` or app release build.
The initial engine, a new upstream CEF version, or a changed engine patch does
require a source build. That expensive work belongs in the separate engine CI
workflow, once per source/build identity and target.

## Current readiness

The producer and downloader are engineering tooling, not a claim of browser
readiness. The release catalog in `native/cef-runtime-releases.json` starts
empty: no published binaries or checksums have been invented. A maintainer must
provision the engine runners, review their build inputs, run publication, and
review/pin each real release descriptor before normal builds can acquire it.
The local Windows engine compilation is separate and is not interrupted by this
workflow. Linux/macOS runtime acceptance and the native TLS acceptance gates
remain required; publishing an SDK does not grant those capabilities.

## Developer flow

1. Normal app builds preserve an existing local runtime registration or explicit
   custom SDK inputs. A stale or corrupt registration fails with guidance; it is
   never silently replaced by another engine.
2. If no registration or explicit SDK was supplied, the build reads this
   checkout's reviewed, target-specific release catalog.
3. The downloader verifies the descriptor's pinned SHA-256, then the archive,
   source lock, manifest and receipt. It checks the extracted SDK inventory,
   target and bridge exports before registering it locally.
4. Subsequent builds reuse the verified local engine. Offline mode only uses
   cached files; it never initiates an engine build or falls back to stock CEF.

The device-local selection remains `.artifacts/cef-local-selection.json`.
Downloaded engines are cached under `.cache/cef-runtime-releases` by identity.
Neither directory is a place to store browser cookies or database secrets.
Explicit acquisition is available through `npm run browser:runtime:fetch -- --help`.

The catalog contains entries of this form (placeholders are not valid pins):

```json
{
  "schemaVersion": 1,
  "kind": "sorng-cef-runtime-releases",
  "targets": {
    "x86_64-pc-windows-msvc": {
      "descriptorUrl": "https://github.com/OWNER/REPO/releases/download/EXACT-TAG/runtime.json",
      "descriptorSha256": "REVIEWED_RAW_DESCRIPTOR_SHA256"
    }
  }
}
```

Never use `latest` or copy an unreviewed checksum from the same untrusted
download. The checked-in descriptor digest is the trust anchor. A digest proves
byte identity, not that native certificate or sandbox tests succeeded.

## Engine runner prerequisites

The dedicated workflow covers Windows, Linux and macOS, each on x64 and ARM64.
It requires appropriately provisioned native engine runners and reviewed
toolchain/GN/source-lock inputs for the selected targets. Do not copy one
developer's absolute toolchain paths into a portable CI contract, generate
placeholder hashes, or install system packages opportunistically during an app
build. The existing lock verifier checks the actual provisioned toolchain bytes.

Source acquisition and compilation must use a short, dedicated workspace
outside this repository and its parent `node_modules` directories. Chromium's
TypeScript resolution can otherwise pick up unrelated application packages.
The producer must keep the pinned CEF version ancestry, bridge ABI and matched
sandbox/bootstrap payloads, not merely a `libcef` library with the right name.

Self-hosted engine runners are deliberately separate from PR validation and app
build workers. GitHub-hosted jobs have a six-hour execution limit; self-hosted
jobs can run up to five days. See [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits).

### Provisioning the workflow

The workflow is `.github/workflows/cef-patched-runtime.yml` (**Patched CEF
engineering runtime**). It runs only by manual dispatch on the default branch;
ordinary app commits and pull requests do not start Chromium builds.

1. Check in a reviewed input directory containing `source-lock.json` and every
   referenced patch, bridge header, GN configuration and toolchain inventory.
   Selecting `all` requires reviewed build entries for all six targets. The
   current workstation's ignored `.artifacts` inputs are not portable CI inputs.
2. Provision native runners with `self-hosted`, `sorng-cef-engine`, the standard
   OS/architecture labels, and `cef-<target-triple>`. Cross-compilation is not
   substituted for a missing native runner. Keep these runners separate from
   untrusted pull-request workloads.
3. Configure their service environment with `SORNG_CEF_TOOLS_ROOT` and a short,
   space-free `RUNNER_TEMP` outside the checkout. Provision sufficient disk for
   source, build objects, the SDK and an extraction-verification copy. The
   workflow does not install system dependencies or delete partial build trees.
4. Each target's toolchain inventory must pin the size and SHA-256 of
   `cef-ci-runner-<target-triple>.json` under the tools root, plus the selected
   Python executable (Python 3.12 or newer). The runner map defines relative
   `python` and `path` entries, bounded `syncJobs` (1–8), `buildJobs` (1–32), and
   an allowlisted environment. Run `npm run browser:runtime:ci -- --help` for
   its exact schema and relocatable `@TOOLS@`, `@SOURCE@` and `@DEPOT@` values.
   This verifies inventoried tools; it is not a claim of a hermetic build.
5. Create the `cef-runtime-publish` GitHub environment with required reviewers
   and default-branch-only deployment restrictions. Repository permissions must
   permit the separate publisher job to create releases. The source-build jobs
   do not receive release-write permission.

The dispatch inputs are `reviewed_inputs` (the checkout-relative directory),
`target` (`all` or one supported target triple), and `publish` (default `false`).
Start with publication disabled to inspect the build and extraction evidence.
Successful builds retain bundles as workflow artifacts for 14 days and logs for
30 days. Those artifacts alone do not update the app's release catalog.

## Publication and updates

Engine publication is an explicit maintainer operation on trusted source,
separate from normal app CI. Retain the source/build identity, the SDK archive,
its complete manifest and build receipt, and the release descriptor together.
Existing published bytes must never be silently overwritten under the same
identity. App changes alone do not require a new engine publication.

The publisher uses a target-specific tag containing the complete source-lock
identity: `cef-patched-<source-lock-sha256>-<target-triple>`. It stages a draft
engineering prerelease, verifies uploaded bytes, uploads `runtime.json` last,
then publishes without making it the latest app release. An existing identical
asset is reused; a different asset under the same identity is rejected, not
overwritten. Retrying the same publication is safe, but manually dispatching a
new engine **build** still starts a fresh source workspace; incremental compiler
cache reuse is not implemented by this workflow.

Use versioned release assets for durable downloads, not expiring workflow
artifacts as the developer dependency. GitHub requires each release asset to be
under 2 GiB; an oversized SDK must be addressed before publishing. See
[GitHub release limits](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas).

After publishing, review the build evidence and descriptor hashes and update
the target catalog. Changes to CEF, the maintained patch queue, GN arguments or
locked toolchain inputs require a new identity and fresh validation. Keeping the
patch queue small reduces maintenance; it does not eliminate upstream security
updates or the need to rebuild the engine when those updates arrive.

The current developer downloader uses credential-free GitHub release downloads.
Private-repository assets need a separate authenticated acquisition design; do
not put access tokens in catalog URLs or metadata.

## Local validation

`npm run browser:runtime:test` runs synthetic producer/download/selection
regression tests. These tests do not compile or launch CEF, prove hosted CI, or
approve production browser admission. The native package and TLS acceptance
workflows remain separate gates.
