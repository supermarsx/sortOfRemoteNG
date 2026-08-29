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

Requirements: Go (>= 1.21), `rustup`, and MinGW `gcc` on `PATH` (MSYS2:
`pacman -S mingw-w64-x86_64-gcc`, then add `C:/msys64/mingw64/bin` to `PATH`).

To only refresh the upstream sources: `npm run vendor:opkssh:checkout`.

## Why the DLL is built with a different toolchain than the app

`build.rs` compiles the Go bridge with `go build -buildmode=c-archive`, which
emits a **GNU-format static archive**. MSVC's linker cannot consume that, so
every MSVC build of this crate is necessarily metadata-only. That is not a bug
and the fallback must keep working — a machine without Go still has to build.

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
`x86_64-pc-windows-gnu`, where CGO static linking works, and the MSVC-built app
loads it unchanged. Only the vendor DLL is built this way; the app itself stays
on MSVC.

## Two details that are easy to get wrong

**The unwinder.** On `*-windows-gnu`, rustc links the unwinder with an explicit
`-lgcc_s`, which resolves to an _import library_ for `libgcc_s_seh-1.dll`. A DLL
carrying that dependency fails to load on any machine without MinGW installed.
`ensure_static_unwinder()` in `build.rs` stages a copy of `libgcc_eh.a` (the same
`_Unwind_*` symbols, statically) named `libgcc_s.a` into a directory searched
first, so `-lgcc_s` resolves statically. A correct build depends only on Windows
system DLLs.

**The checkout location.** The upstream sources live in `.cache/opkssh-upstream`
(gitignored). This used to default to a path under `%TEMP%`, which Windows
reclaims — when it vanished, the build silently downgraded to metadata-only and
nothing in the log said why. Absence is now a loud, actionable warning.

Resolution order: `SORNG_OPKSSH_VENDOR_CHECKOUT` → `.cache/opkssh-upstream` →
the legacy `%TEMP%` path (with a warning). CI sets the env var explicitly.

## Verifying an artifact

Never trust a zero exit code — a metadata-only build links and stages perfectly
happily. `npm run vendor:opkssh:build` verifies automatically, but by hand:

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

| Variable                             | Effect                                                |
| ------------------------------------ | ----------------------------------------------------- |
| `SORNG_OPKSSH_VENDOR_CHECKOUT`       | Path to the upstream checkout. Overrides the default. |
| `SORNG_OPKSSH_VENDOR_GO`             | Explicit path to the `go` binary.                     |
| `SORNG_OPKSSH_VENDOR_DISABLE_BRIDGE` | Set to `1` to force a metadata-only build.            |
| `SORNG_OPKSSH_VENDOR_LIBRARY`        | Runtime override: load the vendor DLL from this path. |
| `SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE`  | Gate used by `stage:opkssh-vendor`.                   |

## Related

- `docs/architecture/opkssh-dylink-adr.md` — why the dylib contract exists.
- `docs/architecture/opkssh-lib-contract.md` — the ABI contract itself.
