---
title: Native build review — 14 September 2026
description: Verified vendor output and OPKSSH build-input cleanup, targeted validation, and limits of the available performance evidence.
permalink: /performance/build-review-2026-09-14/
hide_page_header: true
---

# Native build review — 14 September 2026

## Bounded change

`sorng-aws-vendor` and `sorng-compression-vendor` now emit only `rlib`, not an
additional Rust `dylib`. Their dependency versions, default features, public
re-exports, ordinary Rust consumers, and the application's full feature set are
unchanged. This removes two unused dynamic-link outputs; **no fresh build-speed
or executable-size improvement has been measured**.

The wrappers are normal path dependencies of `sorng-aws` and `sorng-recording`.
Source and packaging searches found no wrapper-specific runtime loader or bundle
requirement. Read-only inspection with the repository's `readPeImports` helper
found neither wrapper DLL among the 43 imports of the current full/static
`src-tauri/target/debug/app.exe` (374,675,456 bytes, modified
2026-09-14 00:29:26 UTC). This is pre-change artifact evidence, not a rebuilt-app
or runtime acceptance claim.

The existing `sorng-rdp-vendor` manifest already follows this pattern: its unused
companion DLL previously exceeded MSVC's import-library export limit (LNK1189).
That history does not imply AWS or compression currently hits the same limit.

The Rust compiler prefers available `rlib` dependencies for an executable unless
`prefer-dynamic` is requested. Listing both crate types produces both artifacts;
it does not establish that the application uses the dynamic one. A re-export
wrapper also does not stop normal downstream recompilation: Cargo already caches
unchanged dependencies. See the [Rust Reference on linkage](https://doc.rust-lang.org/reference/linkage.html).

This does **not** remove native zstd support or change its C linkage selection.
The staged OpenH264, Kafka, SQLite, SSH and OPKSSH runtime contracts are separate
and remain intact. No features were gated, no dependency was removed, and
`Cargo.lock` was not changed by this cleanup.

## Avoiding unrelated OPKSSH build-script invalidation

The MSVC OPKSSH build-script branch reads a fixed staged DLL and returns without
discovering or invoking Go. It nevertheless registered `PATH` and `Path` as
inputs before that return. Those two watches now occur only in the Go-building
branch; explicit checkout/disable/Go overrides and staged-DLL change/health checks
remain unchanged. Cargo reruns scripts when watched environment values change,
so shell/npm path differences need not invalidate the metadata-only MSVC wrapper.
See [Cargo's change-detection contract](https://doc.rust-lang.org/cargo/reference/build-scripts.html#rerun-if-env-changed).

An isolated compilation of the original `build.rs` reproduced both unwanted
MSVC watches. After the move, all four regression tests passed: MSVC x64/ARM64
retained missing/valid/stub/wrong-architecture DLL checks without path watches;
GNU retained them and stopped at a synthetic missing checkout without invoking
Go. Disabled/cross-platform branches also retained their explicit inputs.
Real staged DLLs, user environment and checkouts were untouched.

A subsequent full-app build attempt before this watch fix reached final linking
but could not replace the running, locked `app.exe` (AccessDenied); it was **not
a successful full build**. Its timing trace showed another commands/app rebuild
tail, but did not establish the precise invalidation cause through fingerprint
logging. Neither that attempt nor the fixture tests measure an end-to-end speedup.

CI runs the source contract in `opksshBuildScript.node-test.mjs`; the three
compiled fixtures explicitly skip unless an executable is supplied. To run all
four on Windows without Cargo or a real Go build, from the repository root:

```powershell
$opksshFixtureDir = Join-Path ([System.IO.Path]::GetTempPath()) ("sorng-opkssh-watch-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $opksshFixtureDir | Out-Null
$opksshFixtureExe = Join-Path $opksshFixtureDir "build-script.exe"
rustc --edition 2021 --crate-name opkssh_watch_fixture -C debuginfo=0 src-tauri/crates/sorng-opkssh-vendor/build.rs -o $opksshFixtureExe
if ($LASTEXITCODE -ne 0) { throw "Build-script fixture compilation failed" }
node --input-type=module -e 'import { spawnSync } from "node:child_process"; const result = spawnSync(process.execPath, ["--test", "tests/tooling/opksshBuildScript.node-test.mjs"], {env:{...process.env,SORNG_TEST_OPKSSH_BUILD_SCRIPT:process.argv[1]},stdio:"inherit",windowsHide:true}); process.exitCode=result.status ?? 1;' $opksshFixtureExe
```

## Measured baseline, not new results

The [10 September full-featured build report](build-timings-2026-09-10.md)
remains the measured evidence. Its single-run Cargo times were:

| Case                |   Static | Dynamic-native |
| ------------------- | -------: | -------------: |
| Clean               | 436.67 s |       438.99 s |
| Small RDP leaf edit |  56.05 s |        55.44 s |
| Steady no-op        |   3.05 s |         3.21 s |

The managed dynamic invocation additionally incurred staging/validation work.
Those runs had equal normalized application-domain features, **not identical
native capabilities or library versions**; they do not justify changing the
production linkage mode. See that report for wall time, environment, native
version differences, final-link bounds and retained evidence.

The measured leaf edit rebuilt fourteen Cargo units. The late build path passed
through broad command facades, the app library and the app binary; clean
`sorng-commands-ops` frontend time was about 111 seconds in both modes. Profiling
and narrowing that rebuild tail is a more promising next investigation than
turning arbitrary Rust crates into DLLs. These are September 10 observations,
not newly measured attribution or a promise of savings.

## Regression boundary and next experiment

`tests/tooling/nativeFeatureDefaults.node-test.mjs` checks the wrappers' rlib-only
outputs, complete unconditional re-exports/default dependency capabilities,
ordinary consumer paths and absence from runtime staging. Its existing checks
retain full/static/platform application-feature parity. Run it with:

```powershell
node --test tests/tooling/nativeFeatureDefaults.node-test.mjs
```

Targeted verification passed on 14 September:

- `cargo build -p sorng-aws-vendor -p sorng-compression-vendor --lib --locked`
  built both rlib-only wrappers.
- `cargo check -p sorng-commands-core --locked` checked the command facade and
  its AWS/recording consumer graph.
- The Node build-contract suite above passed all five tests.

These are targeted compilation and source-contract checks, not a full-app
build, runtime smoke test, CI result or new performance benchmark.

Any new dynamic component boundary should start as one measured, versioned
C-ABI or IPC prototype with explicit ownership, loading, failure recovery and
packaging tests. Compare clean/incremental time and total shipped artifacts,
while preserving required native capabilities. No blanket Rust DLL conversion
or reduced-feature default was introduced.
