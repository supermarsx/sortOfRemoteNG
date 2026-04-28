# Vendored & Patched Crates

This document tracks every third-party crate that has been vendored into the
workspace or overridden via a `[patch.crates-io]` entry in
`src-tauri/Cargo.toml`. Each entry records the upstream source, the reason
for vendoring / patching, the last time the vendored copy was synchronised
with upstream, and the responsible owner.

Whenever a vendored crate is re-synced or a patched crate is updated, bump
the **Last sync** column in the same PR.

## Conventions

- **Vendor crates** (`sorng-*-vendor`) are first-party wrappers that
  dynamically link a cluster of third-party dependencies into a single
  `dylib`. They intentionally do not copy upstream source into the tree;
  they pin upstream versions via `Cargo.toml` and exist to cut rebuild
  times and force a single monomorphisation of heavy generic trees.
- **Patch crates** (`src-tauri/patches/<name>/`) contain upstream source
  copied verbatim from crates.io (see each crate's `Cargo.toml.orig`) with
  local modifications applied on top. They are activated through
  `[patch.crates-io]` in the workspace root manifest.

## Vendor wrapper crates

| Crate                       | Upstream deps (pinned)                                                                                                           | Rationale                                                                                           | Last sync  | Owner         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------- | ------------- |
| `sorng-rdp-vendor`          | `ironrdp` 0.14 (+ `ironrdp-blocking` 0.8, `ironrdp-svc` 0.6, `ironrdp-dvc` 0.5, `ironrdp-core` 0.1, `ironrdp-cliprdr[-native]` 0.5), `openh264` 0.6 | Collapse the IronRDP generic tree into a single `dylib` so `sorng-rdp` rebuilds do not re-link it. | 2026-04-20 | rdp-team      |
| `sorng-aws-vendor`          | `quick-xml` 0.31 (serialize), `percent-encoding` 2.3, `hmac` 0.12, `sha2` 0.10, `hex` 0.4                                        | Dynamically link the AWS SigV4 / XML dependency cluster used by `sorng-aws` and `sorng-s3`.         | 2026-04-20 | cloud-team    |
| `sorng-compression-vendor`  | `zstd` 0.13, `flate2` 1.0                                                                                                        | Single compiled copy of the native compression C deps shared across recording, backup and transport. | 2026-04-20 | platform-team |
| `sorng-opkssh-vendor`       | pinned `openpubkey/opkssh` checkout at `193d79871f3bad3cd27cfb94734c265773a99c9b` plus a repo-owned embedded bridge overlay when present; otherwise metadata-only | Optional OPKSSH wrapper contract crate. The app can link or runtime-load it for truthful metadata and a narrow typed client-config bridge, while bundle staging remains explicitly opt-in. | 2026-04-28 | ops-team      |

## Deferred wrapper notes

- `sorng-opkssh-vendor` is now a normal workspace member. `sorng-opkssh` can query it either through the crate feature `vendored-wrapper` or by runtime-loading a wrapper library from `SORNG_OPKSSH_VENDOR_LIBRARY`, a packaged `$RESOURCE/opkssh/...` copy, or the staged workspace bundle tree.
- The wrapper now exports two real operations when an embedded bridge is available: typed client-config load and library-backed login. Build discovery still prefers `SORNG_OPKSSH_VENDOR_CHECKOUT`, then falls back to the local `C:/Users/Mariana/AppData/Local/Temp/opkssh-copilot` checkout for this repo slice. When the selected checkout is a clean upstream tree, the build script overlays the repo-owned bridge sources onto a temporary copy before invoking Go so CI does not depend on an unpublished local working tree. If the checkout or Go toolchain is unavailable, the wrapper stays metadata-only and truthfully reports `embedded_runtime = 0` / `backend_callable = 0`.
- CI now checks out `openpubkey/opkssh` at `193d79871f3bad3cd27cfb94734c265773a99c9b` into `.ci/opkssh-source`, installs Go `1.24.12`, and points `SORNG_OPKSSH_VENDOR_CHECKOUT` at that pinned source path. That keeps the embedded wrapper build reproducible while leaving the local env override path intact.
- `npm run stage:opkssh-vendor -- --enable [--release]` or `SORNG_ENABLE_OPKSSH_VENDOR_BUNDLE=1` stages the native library into `src-tauri/crates/sorng-opkssh-vendor/bundle/opkssh/<platform>-<arch>/`. The staging helper also prepends `SORNG_OPKSSH_VENDOR_GO` or the standard Scoop Go install path to the cargo subprocess `PATH` when present so the embedded bridge can build even if the calling shell has a stale Go PATH. The default path is disabled and scrubs stale staged artifacts so bundling remains optional.
- `src-tauri/tauri.conf.json` still maps `crates/sorng-opkssh-vendor/bundle/opkssh/` into `$RESOURCE/opkssh/`, but that resource tree only contains files when the staging gate is explicitly enabled.
- When the wrapper truthfully reports `login_supported = 1`, `sorng-opkssh` now prefers the wrapper/runtime path for login while preserving CLI fallback when the wrapper is unavailable or an older metadata-only build is loaded. End-to-end live provider/OIDC validation is still a separate gap; the wrapped path is only claimed to the extent the bridge actually exports it.

## `[patch.crates-io]` overrides

All four entries below are patches against the upstream IronRDP 0.8 / 0.5
releases published by Devolutions. Source was copied from crates.io (see
`Cargo.toml.orig` in each directory) and edited to add / fix behaviour
we need for Network Level Authentication, dynamic virtual channels, and
session resume. See each patch's top-level module docs for the diff
summary.

| Patch entry          | Upstream URL                                                                              | Pinned version | Rationale                                                                                                | Last sync  | Owner    |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- | ---------- | -------- |
| `ironrdp-connector`  | https://github.com/Devolutions/IronRDP/tree/master/crates/ironrdp-connector                | 0.8.0          | Expose internal connector state / credential hooks required by our NLA + smart-card credential flow.     | 2026-04-20 | rdp-team |
| `ironrdp-blocking`   | https://github.com/Devolutions/IronRDP/tree/master/crates/ironrdp-blocking                 | 0.8.0          | Adjust blocking I/O wrapper to surface partial-read errors and plug our tracing span propagation.        | 2026-04-20 | rdp-team |
| `ironrdp-session`    | https://github.com/Devolutions/IronRDP/tree/master/crates/ironrdp-session                  | 0.8.0          | Patch session decode to tolerate the non-standard server-initiated disconnect codes observed in prod.    | 2026-04-20 | rdp-team |
| `ironrdp-dvc`        | https://github.com/Devolutions/IronRDP/tree/master/crates/ironrdp-dvc                      | 0.5.0          | Fix DVC channel close handshake + expose hooks required by `sorng-rdp` clipboard & display channel code. | 2026-04-20 | rdp-team |

## Sync procedure (patches)

1. `cargo search <crate>` to confirm the newest upstream version.
2. `cargo package --list` the upstream crate or download the `.crate`
   tarball from crates.io and diff it against the local `patches/<crate>`
   copy.
3. Re-apply the local diff on the new upstream source.
4. Update the pinned version in `[patch.crates-io]` if the minor/major
   changed, then bump the **Last sync** column in this file.
5. Run `cargo update -p <crate>` and the full test matrix.

## Sync procedure (vendor wrappers)

1. Bump the upstream version(s) in the wrapper's `Cargo.toml`.
2. `cargo update -p <wrapper> --aggressive`.
3. Run the downstream crate's test suite (`sorng-rdp`, `sorng-aws`, etc.).
4. Update the **Last sync** column above.

## Automation

A weekly GitHub Actions job defined in
[`.github/workflows/cargo-update.yml`](../../.github/workflows/cargo-update.yml)
runs `cargo update` against the workspace and opens a PR with the
resulting `Cargo.lock` changes. The job runs every Monday at 04:00 UTC
(`cron: '0 4 * * 1'`). Review output against this file — any upstream
that has moved needs a matching **Last sync** bump here.
