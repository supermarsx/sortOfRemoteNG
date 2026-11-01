---
title: Native build review — 14 September 2026
description: Verified vendor output cleanup, targeted validation, and limits of the available performance evidence.
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
The staged OpenH264, Kafka, SQLite and SSH runtime contracts are separate
and remain intact. No features were gated, no dependency was removed, and
`Cargo.lock` was not changed by this cleanup.

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
