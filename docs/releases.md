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

`YY` is the two-digit UTC year. `N` is allocated monotonically from the existing bare tags and resets to 1 when the UTC year changes; `26.1` is the first-release example for 2026. The allocator owns this public identity; it synchronizes `version.json` and every machine projection in the release snapshot rather than accepting unrelated version strings from separate jobs. The README badge resolves GitHub's latest public Release directly, so hidden drafts never appear current. The verified snapshot and its bare tag are pushed atomically, fast-forwarding `main` only when it still identifies the exact gated source commit. Its generated `[skip ci]` commit keeps package metadata current without starting a duplicate release cycle. CI fetches the complete tag namespace and rejects a canonical version below the highest allocated strict tag. Allocated tags remain the version floor even when their draft or publication later fails; this prevents subsequent work based on the pre-snapshot source commit from silently restoring older package metadata.

The workflow records the successful `main` commit as the release `source_sha`.
Its immutable bare tag identifies a version-synchronized snapshot commit whose
`Release-Source-SHA` trailer maps back to that source. A newly created snapshot
becomes the next `main` commit and is the exact tree used by release builds, while release
notes and recovery retain the original source identity. Tag creation and the
`main` fast-forward use one atomic push with an exact-source lease; if `main`
advances first, neither ref is updated and the newer commit must complete its
own gates. A rerun for the same `source_sha` must reuse the reserved tag and
existing GitHub Release; it must not allocate another `N`.

Repository rules must allow the release workflow actor to fast-forward `main`;
otherwise the leased atomic push fails before either the branch or tag moves.

## Release path

1. Run the normal CI jobs and the exact-source `Audit`, `Backend Coverage`, `Frontend Build`, and `Docker e2e (nightly)` gates.
2. Queue the successful `main` source commit, allocate or recover its bare `YY.N` tag, synchronize every public and machine version projection, and atomically fast-forward `main` with the tagged release snapshot.
3. Build Windows x64 and ARM64 installers plus an architecture-matched, installer-free portable ZIP for each, Linux x64 and ARM64 AppImage, Debian, RPM, and Flatpak bundles, macOS Intel bundles, and macOS Apple Silicon bundles.
4. Publish the public OS installers and application bundles. When every credential for an optional OS-signing capability is absent, CI records that intentional unsigned mode in the job summary without creating a warning annotation. A partial Apple credential set fails closed; a fully absent set leaves the macOS bundles truthfully OS-unsigned and does not suppress the release.
5. When `TAURI_SIGNING_PRIVATE_KEY` is configured, generate and validate signed updater artifacts for `windows-x86_64`, `windows-aarch64`, `linux-x86_64`, `linux-aarch64`, `darwin-x86_64`, and `darwin-aarch64`.
6. Generate and validate `latest.json` in both signed and unsigned modes, and include it in every successfully promoted release. Signed mode references the verifiable updater payloads. Without the updater key, the feed declares `updater_signing: false`, carries empty signature strings, and links to the existing public installers only for discovery and manual installation. An updater password configured without its private key fails closed as an incomplete secret set. Once the latest public release has a signed updater feed, the signing key must remain available: promotion fails rather than replacing that usable signed feed with an unsigned discovery feed.

The Windows x64 and ARM64 portable ZIPs are installer-free extract-and-run packages. Each archive contains the executable for its named architecture, the adjacent `.portable` runtime marker, and the bundled OPKSSH resources; release CI extracts the ZIP and verifies those files against the matching build inputs. Here, portable describes delivery without an installer; it does not promise that every setting, credential, cache, operating-system dependency, or updater state remains inside the extracted directory.

Portable ZIPs are part of the exact public asset contract and, like every release asset, are downloaded again by immutable release ID and checked against GitHub's SHA-256 digest before promotion. Per-target provenance records the build target and signing state; it does not duplicate the release-asset digest ledger.

Linux AppImage, Debian, and RPM bundles use Tauri's native resource layout:
`/usr/lib/sortOfRemoteNG/opkssh` under their package or mounted prefix. Release
CI inspects all three formats and compares their packaged OPKSSH file lists with
the staged source bundle. The single-file Flatpak bundles are built from the
same native executable on the corresponding x64 or ARM64 runner using the
checked-in `packaging/flatpak/com.sortofremote.ng.yml` manifest,
`org.gnome.Platform//50`, `org.gnome.Sdk//50`, and the pinned
`flatpak-builder` 1.4.2 tool. The Flatpak keeps OPKSSH resources beside the
executable at `/app/bin/resources/opkssh`, matching the runtime lookup rooted
at `current_exe()`. Installing the `.flatpak` may download the pinned GNOME
runtime from Flathub. RPM and Flatpak are public install artifacts; automatic
updates are available only to signed AppImage installations on Linux. Flatpak
builds intentionally do not check or install `latest.json` updates because
`/app` is read-only. Flatpak users update by downloading the newer
architecture-matched `.flatpak` asset from GitHub Releases and installing it
manually, for example with
`flatpak install --user --reinstall ./sortOfRemoteNG_<version>_linux-<arch>.flatpak`.

In-app self-update is package-type specific. It is supported only by Linux
AppImage, Windows NSIS, Windows MSI, and macOS app-bundle installations because
those are the payloads named in `latest.json`. Windows carries two payloads per
architecture: NSIS installs resolve the `windows-<arch>` platform key and MSI
installs resolve `windows-<arch>-msi`, so neither ever installs the other's
bytes beside itself. An MSI update runs `msiexec /passive` against a
per-machine install and therefore always prompts for administrator approval;
the app closes when the install starts and relaunches itself when it finishes,
and declining the prompt cancels the update and leaves the app closed at its
current version. Debian, RPM, Flatpak, and portable ZIP installations must
download and reinstall or replace the newer matching public asset from GitHub
Releases; they do not install an AppImage, NSIS, or MSI payload over their
current package layout.

<div class="callout callout--danger">
  <strong>Never commit the updater private key.</strong>
  <p>The embedded public key is repository configuration. The private key and its password belong only in the release secret store and the maintainers’ controlled backup.</p>
</div>

## Detailed runbooks

- [Updater signing and public-feed setup]({{ '/release/updater-setup/' | relative_url }}) covers key storage, feed schema, signature validation, and rotation.
- [Private updater endpoint]({{ '/release/private-updater-endpoint/' | relative_url }}) describes the Settings-managed private endpoint and fallback policy.
- [Apple Developer enrollment]({{ '/release/apple-developer-enrollment/' | relative_url }}) tracks macOS signing and notarization prerequisites.
- [Windows EV certificate]({{ '/release/windows-ev-cert/' | relative_url }}) tracks Authenticode/SmartScreen signing prerequisites.

OS-level code signing and updater signing solve different problems. Unsigned public bundles may prompt platform warnings. Every release has validated version metadata in `latest.json`, but automatic installation is available only when its updater artifacts are signed with the protected Tauri key. The backend refuses an empty-signature entry before downloading it and leaves the public artifact link available for manual installation.

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
npm run version:floor:check
npm run version:check
npm run release:test
```

Security-sensitive release changes should be reviewed against [Security]({{ '/security-overview/' | relative_url }}) and the signing runbooks above.
