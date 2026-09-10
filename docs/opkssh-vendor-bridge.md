---
title: Building the OPKSSH vendor bridge
description: Build, verify, and stage the bridge-carrying OPKSSH vendor DLL for Windows releases.
permalink: /opkssh-vendor-bridge/
hide_page_header: true
---

# Building the OPKSSH vendor bridge

The OPKSSH vendor DLL (`sorng_opkssh_vendor.dll`) can be built in two shapes:

- **Metadata-only** — exports the C ABI and answers the probe functions, but
  `sorng_opkssh_vendor_embedded_runtime()` returns `0`. Login falls back to the
  external `opkssh` CLI and the app reports "no embedded libopkssh runtime".
- **Bridge-carrying** — the same C ABI, plus a statically linked Go
  `libopkssh` runtime. `embedded_runtime()` returns `1` and the app runs OPKSSH
  login in-process.

This document covers producing the second one.

## Quick start

```bash
npm run vendor:opkssh:build
```

That clones the pinned upstream checkout if needed, builds the bridge, verifies
the result actually embeds Go, and stages it into
`src-tauri/crates/sorng-opkssh-vendor/bundle/opkssh/windows-amd64/`.

Requirements: Go compatible with the pinned upstream `go.mod`, `rustup` with
`stable-x86_64-pc-windows-gnu` already installed, and MinGW `gcc` on `PATH` (MSYS2:
`pacman -S mingw-w64-x86_64-gcc`, then add `C:/msys64/mingw64/bin` to `PATH`).

To only refresh the upstream sources: `npm run vendor:opkssh:checkout`.

Normal `npm run tauri:dev` / `npm run tauri dev` now run verified staging before
starting the desktop process. Production's `stage:opkssh-vendor` also uses this
path. On Windows x64, healthy staged/cached GNU bridges are preserved; a missing
bridge invokes the builder above. A failed build never replaces the staged
artifact, and staging one target never clears other target directories. The
builder does not install Rust toolchains automatically.

Use `SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE=1` for explicit CLI-only operation (the
external CLI must be installed separately). `stage:opkssh-vendor -- --disable`
removes only the selected target's staged DLL. The generic staging command is
enabled by default; `SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE=0` disables it unless
`--enable` was explicitly supplied. `SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE=1`
always wins, including production pre-build's `--enable`.

For Windows ARM64, use a **native ARM64 Windows Rust host**, Go compatible with
the pinned upstream `go.mod`, and LLVM-MinGW's ARM64 binaries on `PATH`:

```sh
rustup target add aarch64-pc-windows-gnullvm
npm run vendor:opkssh:build -- --target aarch64-pc-windows-gnullvm
```

The ARM64 helper uses the active Rust toolchain (including CI's pinned version),
`aarch64-w64-mingw32-clang` for CGO and the Rust linker, and a separate
`target-opkssh-gnu/aarch64-pc-windows-gnullvm` cache. Normal staging with
`--target aarch64-pc-windows-msvc` selects this builder automatically. The
helper checks the Rust host architecture before checkout/build and refuses an
x64 host; it does not install tools. LLVM-MinGW's GCC-unwinder shim is not used.
The [Rust target guide](https://doc.rust-lang.org/rustc/platform-support/windows-gnullvm.html)
documents the required LLVM-MinGW environment.

The pinned native ARM64 LLVM-MinGW distribution is
[`llvm-mingw-20260616-ucrt-aarch64.zip`](https://github.com/mstorsjo/llvm-mingw/releases/download/20260616/llvm-mingw-20260616-ucrt-aarch64.zip).
Verify SHA-256
`312593669435bd0bfc1a43ac3fba23c8b27e0610bade88b2738e5a01702a99ba`
before extraction; this matches the publisher's GitHub release asset digest.
Add the extracted `bin` directory to `PATH`. No x64 bridge is accepted for ARM64.
ARM64 runtime validation must run on a native ARM64 runner; x64 build/tests do
not establish that result.

Alternatively, `SORNG_OPKSSH_VENDOR_ARTIFACT` can specify an absolute path to a
trusted matching prebuilt bridge. Staging applies the same validation and never
substitutes an MSVC metadata stub. The override works for other targets too.

## Why the DLL is built with a different toolchain than the app

`build.rs` compiles the Go bridge with `go build -buildmode=c-archive`, which
emits a **GNU-format static archive**. MSVC's linker cannot consume that, so
every MSVC build of this crate is necessarily metadata-only. That is not a bug
and explicit CLI-only builds remain supported on machines without Go.

The way out is that **the app does not static-link the vendor crate at runtime.**
`sorng-opkssh/src/binary.rs` dlopens the staged DLL with `libloading` and calls a
small C ABI:

```
sorng_opkssh_vendor_abi_version
sorng_opkssh_vendor_embedded_runtime
sorng_opkssh_vendor_backend_callable
sorng_opkssh_vendor_config_load_supported
sorng_opkssh_vendor_login_supported
sorng_opkssh_vendor_login_json
sorng_opkssh_vendor_load_client_config_json
sorng_opkssh_vendor_free_string
```

A C ABI boundary is toolchain-agnostic. So the DLL is built for
`x86_64-pc-windows-gnu` or `aarch64-pc-windows-gnullvm`, where CGO static linking works, and the MSVC-built app
loads it unchanged. Only the vendor DLL is built this way; the app itself stays
on MSVC.

## Two details that are easy to get wrong

**The unwinder.** On `x86_64-pc-windows-gnu`, rustc links the unwinder with an explicit
`-lgcc_s`, which resolves to an _import library_ for `libgcc_s_seh-1.dll`. A DLL
carrying that dependency fails to load on any machine without MinGW installed.
`ensure_static_unwinder()` in `build.rs` stages a copy of `libgcc_eh.a` (the same
`_Unwind_*` symbols, statically) named `libgcc_s.a` into a directory searched
first, so `-lgcc_s` resolves statically. A correct build depends only on Windows
system DLLs. ARM64 gnullvm uses LLVM's unwind implementation and skips this GCC
shim. Artifact verification rejects external GCC, pthread and LLVM unwind DLL
dependencies rather than silently requiring them on user machines.

**The checkout location.** The upstream sources live in `.cache/opkssh-upstream`
(gitignored). This used to default to a path under `%TEMP%`, which Windows
reclaims — when it vanished, the build silently downgraded to metadata-only and
nothing in the log said why. Absence is now a loud, actionable warning.

Resolution order: `SORNG_OPKSSH_VENDOR_CHECKOUT` → `.cache/opkssh-upstream` →
the legacy `%TEMP%` path (with a warning). CI sets the env var explicitly.

## Verifying an artifact

Never trust a zero exit code — a metadata-only build can link successfully.
Both build/staging commands reject it. Windows verification parses the PE
export directory and checks the machine type, not merely symbol text in debug
data. For additional manual inspection:

```bash
D=src-tauri/crates/sorng-opkssh-vendor/bundle/opkssh/windows-amd64/sorng_opkssh_vendor.dll

# Must be 0 - this string only exists in the metadata-only build.
strings -a "$D" | grep -c "embedded OPKSSH runtime is not available in this wrapper build"

# Must be non-zero - Go runtime markers.
strings -a "$D" | grep -cE "runtime.goexit|golang.org|go1\."

# Must list the eight C ABI symbols above.
objdump -p "$D" | grep -o "sorng_opkssh_vendor_[a-z_]*" | sort -u

# Must NOT mention libgcc_s_seh-1.dll.
objdump -p "$D" | grep -i "DLL Name"
```

End to end, the app's own probe should report `activeBackend: "library"` with
`embeddedRuntimePresent: true` and `usingFallback: false` — via
`OpksshService::refresh_runtime_status()`.

## Environment variables

| Variable                             | Effect                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `SORNG_OPKSSH_VENDOR_CHECKOUT`       | Path to the upstream checkout. Overrides the default.                          |
| `SORNG_OPKSSH_VENDOR_GO`             | Explicit path to the `go` binary.                                              |
| `SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE` | Set to `1` to force a metadata-only build.                                     |
| `SORNG_OPKSSH_VENDOR_LIBRARY`        | Runtime override: load the vendor DLL from this path.                          |
| `SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE`  | Gate used by `stage:opkssh-vendor`.                                            |
| `SORNG_OPKSSH_VENDOR_ARTIFACT`       | Absolute matching prebuilt bridge used by staging, with the same verification. |

## Related

- `docs/architecture/opkssh-dylink-adr.md` — why the dylib contract exists.
- `docs/architecture/opkssh-lib-contract.md` — the ABI contract itself.
