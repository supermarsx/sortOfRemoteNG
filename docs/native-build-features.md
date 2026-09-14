---
title: Native build defaults
description: Full-featured native builds, explicit lean alternatives, and platform-specific runtime prerequisites.
hide_page_header: true
---

# Native build defaults

Normal desktop development and direct Cargo builds include all supported native feature families by default. Both `npm run tauri dev` and `npm run tauri:dev` use the managed development launcher with matching frontend port, capability origin and native feature defaults. Restart/rebuild the desktop process to change compiled features; a web reload cannot update a running lean binary.

`default = ["full"]`; `full-dev` is a compatibility alias for `full`. This includes operations, platform integrations, cloud, collaboration, all six database drivers, RDP and its supported decoders/snapshots, Kafka, serial, OPKSSH, certificate details/authentication, script engine and SoftEther. Security, database ownership, permissions and explicit website automation consent are unchanged. Host-specific APIs still require their supported OS, drivers, services and tools.

Reduced builds are explicit:

```sh
cargo run --manifest-path src-tauri/Cargo.toml --no-default-features --features lean
npm run tauri:dev -- --features lean -- --no-default-features
```

Adding `--features lean` alone does not subtract default capabilities. Never use `--all-features`: mutually exclusive native linking variants are not extra functionality.

The default/full bundle builds Kafka and OpenH264 from source, with bundled SQLite. It requires the normal native C/CMake toolchain. `npm run tauri:build` retains its existing platform-specific native-runtime staging, and release CI retains its explicit full feature lists with `--no-default-features`. Those lists choose either static or dynamic variants of Kafka, SQLite and OpenH264, not both. Alternate linkage bundles must also disable defaults.

## Development build parallelism and memory

The two managed Tauri development commands choose Cargo parallelism at each launch from the process-visible CPU count and the current physical free RAM. Their advisory build allowance is `min(40 GiB, max(0, free RAM - 7% of total RAM))`. The estimate reserves 8 GiB within that allowance for Next.js, linking and native helpers, then 1 GiB for each Cargo job, capped by available CPUs. A 40-CPU process with ample free RAM therefore selects 32 jobs, overriding the repository's ordinary 28-job default **only in the dev child environment**.

This is a launch-time sizing heuristic, **not a hard 40 GiB process-tree limit or a guarantee that 7% of RAM remains free**. Individual compiler/linker peaks and unrelated processes vary; Cargo's job limit does not enforce memory usage. If observed headroom is insufficient even for the minimum one-job estimate, the launcher warns and retains one job. It never kills, pauses or retunes an existing build or app, and does not change the application's runtime heap. Restart the managed dev command to recalculate the recommendation.

Explicit `CARGO_BUILD_JOBS` and Cargo `--jobs`/`-j` arguments remain authoritative and are identified in the startup message; they can exceed the advisory recommendation. A custom runner, explicit profile/release invocation or Cargo `--config` also retains its existing policy. Regular Cargo commands, production/release builds, feature sets and optimization profiles are unchanged. For example, `npm run tauri:dev -- -- --jobs 4` explicitly selects four Cargo jobs for that invocation.

## OPKSSH runtime prerequisites

The default includes `opkssh-vendored-wrapper`. Managed development now verifies/stages its real embedded runtime before native launch; production staging uses the same checks. On Windows/MSVC, the statically linked Rust wrapper is deliberately metadata-only: the application dynamically loads a separately staged GNU bridge. On Windows x64, a healthy staged or cached bridge is reused; otherwise `npm run vendor:opkssh:build -- --skip-stage` builds it using the documented Go/GNU-toolchain and pinned-upstream prerequisites. Missing prerequisites fail visibly rather than replacing the bridge with a metadata-only DLL. No toolchain is installed automatically.

For explicit CLI-only development/build, set `SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE=1`. This skips the embedded builder and removes only the selected target's staged bridge; the supported OPKSSH CLI must be installed separately. Other platform bundles are preserved. Direct Cargo builds do not run the Node preflight: run `npm run stage:opkssh-vendor` first if embedded OPKSSH is needed.

Windows ARM64 uses a native ARM64 Rust host, an installed `aarch64-pc-windows-gnullvm` target, Go and LLVM-MinGW. Staging selects this builder for the ARM64 MSVC application; it never builds an x64 substitute. A matching prebuilt bridge can instead be supplied through the absolute `SORNG_OPKSSH_VENDOR_ARTIFACT` path. Staging checks PE architecture, all eight exported ABI entry points and embedded-runtime markers. ARM64 runtime proof requires a native ARM64 runner, and neither compilation nor these checks are live-provider authentication proof. See the pinned LLVM-MinGW download/checksum and [OPKSSH bridge instructions](opkssh-vendor-bridge.md).
