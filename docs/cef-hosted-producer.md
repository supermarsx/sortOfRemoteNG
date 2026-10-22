---
title: Hosted CEF producer prerequisites
description: Observing and reviewing the six hosted toolchains before native runtime builds and publication.
hide_page_header: true
---

# Hosted CEF producer prerequisites

The engineering workflow has two explicit modes. Its existing default, **build**, still requires reviewed input locks, dedicated runners and the protected default-branch publisher. **discover** uses only six fixed standard public-repository runner labels. It gathers observations and never builds CEF, installs an SDK, creates trusted pins, or publishes anything.

Run discovery with `mode=discover`, `publish=false`, and the existing required `reviewed_inputs`/`target` inputs (they are not consumed by discovery). Leave `discovery_cleanup_linux=false` initially. Discovery can run on a reviewed branch because it has no write permission or protected-environment secrets.

Each `cef-hosted-discovery-<target>` artifact contains actual image identity, OS/CPU/RAM/disk observations, Python/compiler/Xcode/SDK paths and versions, real file sizes and SHA-256 hashes, and explicit blockers. `toolchain-candidate.json` is **UNREVIEWED**. A successful observation job is not evidence that Chromium compiled, that a toolchain is complete, or that a target passed native acceptance. Missing tools remain blockers, with no version downgrade.

The reviewed Chromium source requires Visual Studio 2026 and the Windows SDK 10.0.28000 line. The fixed x64 discovery label therefore explicitly selects `windows-2025-vs2026`; the ARM label is `windows-11-arm`. Actual observations must still verify required files. If installation is necessary, first review an exact signed Microsoft installer and its hash; this phase downloads or runs no installer.

On Linux only, an explicit cleanup dispatch can remove the four fixed expendable SDK directories listed in `native/cef-hosted-recipe.json`. The helper requires a public GitHub-hosted Linux runner, exact canonical non-symlink roots, and no overlap with checkout or runner workspaces. It records before/after free space and each removed root. There is no arbitrary cleanup path input. Do not enable cleanup until its concrete list has been reviewed for that image.

## Next build phase

1. Review the six actual observation artifacts and resolve every prerequisite blocker. Pin the actual runner map, Python/native tools and GN bytes in source-lock inputs; do not promote discovery output automatically. Changed hosted images must fail existing hash verification until reviewed again.
2. Add a reviewed hosted build contract with a maximum 350-minute work budget plus final diagnostic retention. Keep dedicated producer behavior intact. Estimate cold source sync/build feasibility from real milestones and stop with retained diagnostics rather than claim an unfinished engine is usable.
3. The macOS ARM64 target may use upstream-supported Intel-to-ARM64 compilation only after an explicit same-OS cross-build contract, target GN pin and actual Mach-O architecture verification. It still needs a separate native ARM64 acceptance job. This discovery phase deliberately rejects architecture mismatches.
4. Reuse only immutable, verified finished bundles or explicitly source-lock/toolchain/image/GN-keyed checkpoints with bounded storage and revalidation. Do not assume a large Chromium tree fits a standard repository cache or that an incomplete object tree proves acceptance.
5. Require all six verified bundles **and** all six native acceptance receipts before publishing the set and reviewing consumer catalog hashes. The user's chosen release policy is to wait for all six, not publish a Windows-only release.

The existing accepted local Windows ACK package may be repackaged into a new immutable publication bundle, but it does not stand in for the other five targets or a hosted runner receipt. No current runtime selection or user process is changed by discovery.
