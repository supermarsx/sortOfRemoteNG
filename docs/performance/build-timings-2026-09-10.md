---
title: Full-featured native build timings — 10 September 2026
description: Measured clean and incremental native build timings comparing static and dynamic-native modes, with evidence limitations.
hide_page_header: true
---

# Full-featured native build timings — 10 September 2026

## Result

Both clean builds and all controlled incremental builds succeeded. This run does **not** establish a build-speed benefit from the existing dynamic-native mode, and does not justify converting arbitrary Rust crates into DLLs. The clean Cargo timelines were approximately 437 versus 439 seconds; dynamic-runtime staging/validation added roughly ten seconds to each managed invocation.

These are full-featured **Rust desktop app development builds**, not Next.js builds, release builds, installers, or an end-to-end package benchmark. The two modes have equal normalized application-domain feature flags, **not identical native capabilities or native-library versions**. In particular, the static Kafka feature selection does not establish parity with the dynamic package's TLS/compression support. Do not switch production to static merely on these timings.

## Measured builds

Seconds; one run per case, no statistical confidence interval. Wall time includes `native-build-env.mjs`; Cargo time is the final endpoint in its HTML timing data, rounded to two decimals. Both steady-state diagnostics also succeeded.

| Case                              | Static wall | Static Cargo | Dynamic wall | Dynamic Cargo |
| --------------------------------- | ----------: | -----------: | -----------: | ------------: |
| Fresh target, unchanged source    |     437.200 |       436.67 |      448.684 |        438.99 |
| First unchanged-source rebuild    |      39.873 |        39.33 |       45.821 |         35.98 |
| Small root-binary edit            |      25.014 |        24.52 |       33.542 |         23.47 |
| Small body edit in large RDP leaf |      56.553 |        56.05 |       65.868 |         55.44 |
| Additional steady-state no-op     |       3.493 |         3.05 |       12.931 |          3.21 |

The first unchanged-source run rebuilt `app_lib` and `app` in both modes. This is not a steady-state no-op. Fingerprint logging on the dynamic run identified the generated 4,096-byte RGBA icon cache `OUT_DIR/9e6328cbc175dc3a4142426f0d3b911ad42b2c65bc3ba1570ca6d8f74249cbc0` as approximately 0.963 seconds newer than `dep-lib-app_lib`. Tauri codegen 2.6.3 creates this cache during `generate_context!()` and includes it with `include_bytes!`; its first creation is later than the compilation-start reference. The next run was fully fresh. The static run showed the same two rebuilt targets and same cache filename, but did not have fingerprint logging on that first run, so its identical cause is an inference.

The static diagnostic followed the root edit; the dynamic diagnostic preceded the root edit. Neither diagnostic changed source. The root edit rebuilt one Cargo unit; the leaf edit rebuilt fourteen, including several command facades and the app. No built app was launched.

## Executable and staged-library sizes

All successful phases in each mode produced the same EXE byte size within that mode; hashes are recorded per phase.

| Artifact subset                            | Static bytes | Dynamic bytes |
| ------------------------------------------ | -----------: | ------------: |
| `app.exe`                                  |  365,477,888 |   361,887,232 |
| Existing OPKSSH vendor DLL, common to both |   16,454,656 |    16,454,656 |
| Nine additional staged native-runtime DLLs |            0 |    13,556,736 |
| Sum of these artifacts only                |  381,932,544 |   391,898,624 |

The EXE shrank by 3,590,656 bytes (3.42 MiB), but this explicit EXE-plus-staged-DLL subset grew by 9,966,080 bytes (9.50 MiB). This is **not** an installation-size comparison: frontend assets, licenses, system/WebView runtimes, installers, compression and other resources are excluded. It is also not a comparison against the later isolated viewer helper, which is absent from the benchmark commit.

## Machine, source and prerequisites

- Snapshot: `da0be7f5194d652ee73c07cd590a9951d0596a0a`, clean linked worktree at `F:/Projects/sortOfRemoteNG-build-timing-20260910/source`.
- Windows 11 Pro `10.0.26200`; two Intel Xeon Gold 6138 CPUs, 20 cores / 40 logical processors each. Windows reports 80 logical processors total; Node's process-visible CPU inventory reported 40. Cargo used 28 jobs; no affinity was changed.
- Installed RAM: 308,877,668,352 bytes (287.66 GiB); about 231 GiB available at preflight. Targets were on F: with ample headroom.
- Rust/Cargo 1.95.0, LLVM 22.1.2, Node 24.14.1, target `x86_64-pc-windows-msvc`, platform MSVC linker. No alternate linker, compiler wrapper, or custom Rust flags.
- Unmodified snapshot `dev` profile: incremental enabled, first-party debug info off, unpacked split debug info, dependency optimization level 1, build-script level 2, named RDP/runtime packages level 2, existing per-package codegen overrides retained. This does not predict release/LTO results.
- Fresh, separate `target-static` and `target-dynamic` directories. Cargo downloads and OS filesystem caches were warm; no `cargo clean`, user-target reuse, user-process termination or user-app restart.
- Native prerequisite copies took 1.382 seconds including inventory/hashing. Static prerequisite metadata took 2.807 seconds. Dynamic prerequisite rebuilding/staging plus metadata took **252.019 seconds**, separate from all build columns. Relocating the existing cache actually rebuilt eight native packages; this was not free reuse of prebuilt binaries.
- Pinned vcpkg baseline: `b9b668c1de09b065f53a3943939801b901b585ef`. Benchmark-local installed/staged outputs used the existing pinned vcpkg tool and warm downloads. The real OPKSSH vendor artifact was copied unchanged, not replaced by a stub.

The dynamic triplet uses release native libraries with static CRT, whereas source-built native dependencies inherit their respective Cargo/cc settings. Dynamic versions include librdkafka 2.15.0, libssh2 1.11.1, OpenH264 2.6.0, OpenSSL 3.6.4, SQLite 3.53.4, lz4 1.10.0, zlib 1.3.2 and zstd 1.5.7. Static `rdkafka-sys` is `4.10.0+2.12.1`; its selected source-build flags include `cmake-build` and `libz`, while the dynamic vendor enables SSL/zstd and additional features. SQLite and OpenH264 also switch source/linkage paths, and the dynamic wrapper selects pkg-config libssh2. Native capability/version/optimization parity remains an outstanding prerequisite for a stricter linkage-only experiment.

No other Cargo/native compiler gate ran concurrently. The existing user dev process remained untouched. Small parent/agent formatting, lint and focused Node/Vitest checks did overlap portions of the runs: parent checks about two seconds; agent checks included 27 cases in 5.66 seconds, 14 mocked staging cases in 0.351 seconds, 22 boundary cases in 2.54 seconds, and short formatting/lint operations. Background OS activity was not controlled. These are useful workstation observations, not laboratory-isolated statistical results.

## Slow units and the late build path

Top ten Cargo units by duration for each clean run. Units overlap; **do not sum these columns**. `build run` includes the native subprocess work performed by that build script. The dynamic list contains Windows bindings 0.62.2 (72.03 seconds) and 0.61.3 (67.51 seconds); the static top-ten entry is 0.62.2. These are distinct Cargo units, not an accidental duplicate.

| Rank | Static unit               | Seconds | Dynamic unit           | Seconds |
| ---- | ------------------------- | ------: | ---------------------- | ------: |
| 1    | aws-lc-sys — build run    |  128.30 | aws-lc-sys — build run |  123.23 |
| 2    | sorng-commands-ops        |  118.68 | sorng-commands-ops     |  119.25 |
| 3    | rdkafka-sys — build run   |  113.77 | app library            |  106.70 |
| 4    | app library               |   98.27 | sorng-commands-core    |   82.32 |
| 5    | openh264-sys2 — build run |   87.64 | mongodb                |   72.91 |
| 6    | sorng-commands-core       |   82.93 | windows                |   72.03 |
| 7    | mongodb                   |   76.89 | tauri-utils            |   71.35 |
| 8    | tauri-utils               |   76.71 | windows                |   67.51 |
| 9    | windows                   |   72.77 | sorng-commands-infra   |   65.49 |
| 10   | sorng-commands-infra      |   71.73 | yuv                    |   63.32 |

Cargo's recorded unit-unblock/metadata-unblock edges show the late chain through Tauri macros, storage/SSH dependencies, `sorng-commands-ops`, the app library, then the app binary. Pipelining matters: the static commands-ops frontend ends at approximately 318.34 seconds and the app library starts at 318.33; the library finishes at 416.60, then the binary finishes at 436.67. Dynamic equivalents are 312.17, 312.18, 418.88 and 438.99 seconds. Rounded timestamps overlap slightly. This is observed scheduling/critical-tail evidence, not a formal sum of crate durations.

The commands-ops frontend alone takes 111.34 / 111.35 seconds (static/dynamic). The app-library frontend takes 72.04 / 78.67 seconds. Early static Kafka/OpenH264 native builds finish around 152.46 / 128.66 seconds, well before this late tail. Removing their compile work therefore does not automatically remove the same amount from total wall time.

### Observed final native linker bounds

A read-only observer sampled descendant `link.exe` processes using process creation timestamps and repeated process snapshots. It did not replace the linker. Nominal polling was 500 ms plus query overhead, generally yielding 0.5–0.8-second bounds. Very short processes between samples can be missed. The final long-lived descendant link overlaps the final app-binary unit; that association is inferred from timing, not an instrumented linker command label.

| Case                           | Static final link seconds | Dynamic final link seconds |
| ------------------------------ | ------------------------: | -------------------------: |
| Clean                          |             17.683–18.200 |              17.735–18.254 |
| First unchanged-source rebuild |             20.322–21.084 |              18.634–19.361 |
| Root edit                      |             18.612–19.364 |              17.610–18.349 |
| RDP leaf edit                  |             18.787–19.493 |              18.577–19.098 |

The full clean app-binary Cargo units take 20.07 / 20.10 seconds; these are **not** linker-only measurements. The steady no-op diagnostics observed no final link.

## Reproduction and retained evidence

From the isolated snapshot's `src-tauri` directory, the static command was:

```powershell
node ../scripts/native-build-env.mjs cargo build --locked -p app --bin app --no-default-features --features full --target x86_64-pc-windows-msvc --target-dir F:/Projects/sortOfRemoteNG-build-timing-20260910/target-static --jobs 28 --timings --message-format=json-render-diagnostics
```

The dynamic command adds `--dynamic-native-runtime` before `cargo` and uses `target-dynamic`. The managed wrapper rewrites `full` to `full-windows-dynamic`, stages/validates the native runtime and sets its scoped build environment. Full application-domain feature closure was compared using locked Cargo metadata; no `--all-features` or mutually exclusive static/dynamic combination was used.

Run order was static clean → first no-op → root edit → diagnostic no-op → leaf edit; restore baseline; dynamic clean → first no-op → diagnostic no-op → root edit → leaf edit. The root edit adds `std::hint::black_box("SORNGBENCH_ROOT_PROBE_V1");` before `app_lib::run()` in `src/main.rs`. The leaf edit changes only the `conn_span` tracing field from `proto = "rdp"` to `proto = "rdp-benchmark-v1"` in `crates/sorng-rdp/src/lib.rs`; the root edit remains during that phase. Both source files were restored byte-for-byte, including CRLF, and the tracked worktree was clean afterward. These edits benchmark invalidation, not runtime functionality or public-API changes.

`CARGO_LOG=cargo::core::compiler::fingerprint=info` was enabled only for the dynamic first no-op and both extra no-op diagnostics. Evidence is retained outside the production repository at `F:/Projects/sortOfRemoteNG-build-timing-20260910/`: `benchmark.mjs`, `observe-link.ps1`, `summarize-preflight.mjs`, `analyze.mjs`, and `logs/`. Each phase has command/timestamps/exit status/source hashes/EXE hash and bytes in JSON, stdout/stderr, sampled linker JSONL, and an archived Cargo HTML timing report. `environment.json`, `feature-parity.json` and `analysis.json` preserve supporting data. Large logs/binaries are intentionally not committed.

## Recommendation

Preserve required native TLS, codec and database capabilities. These measurements do not justify a switch to static or a blanket Rust DLL rewrite. Prioritize profiling the large Rust frontend/command-registration paths, avoiding unnecessary generated-input invalidation, and caching unchanged dynamic staging/validation safely. Any proposed stable ABI boundary needs its own measured end-to-end experiment, including setup, total shipped artifacts, relinking, version parity and runtime acceptance. The first-use icon issue and staging overhead are identified here, not changed by this benchmark.
