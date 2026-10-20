# Updater ZIP security backport

This is `tauri-plugin-updater` **2.10.1**, copied from the published crates.io
archive. The original archive SHA-256 is
`806d9dac662c2e4594ff03c647a552f2c9bd544e7d0f683ec58f872f952ce4af`.
The retained `.cargo_vcs_info.json` identifies upstream source commit
`d6a3898001a4bcc659e045f9501498751b77dbe6`, path `plugins/updater`.

The Windows optional `zip` dependency is backported from major version 4 to 9
in both Cargo manifests, following the upstream updater dependency migration:
[ba98bfadc4c868c9a7e1a226c83af528e1f11b89](https://github.com/tauri-apps/plugins-workspace/commit/ba98bfadc4c868c9a7e1a226c83af528e1f11b89).
The upstream production updater change requires no extraction API rewrite.
The application lockfile selects ZIP 9.0.5.

ZIP versions before 9 are affected by
[RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html),
[RUSTSEC-2026-0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html) and
[RUSTSEC-2026-0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html),
covering unsafe permission bits, escaping symbolic links, and permission changes
that follow symbolic links. Their patched range starts at ZIP 9.0.0.

Keeping updater 2.10.1 preserves compatibility with this application's patched
Tauri 2.11.5. Updating the whole updater package to 2.14 would require Tauri 2.12
and is outside this backport. Package version, public Rust API, update signature
verification, installer launch behavior and non-Windows extractors are retained.

The production Windows ZIP extraction calls a small shared helper containing
the same `ZipArchive::extract` operation. Windows ZIP-feature unit tests exercise
that actual helper with synthetic installer/nested files, parent traversal, and
an escaping symlink followed by a write attempt. They do not execute installers,
download updates, or claim Unix permission-bit runtime coverage.

Unused guest TypeScript, npm/rollup/TypeScript package configuration, banner,
registry completion marker and the crate-local lockfile were removed. All Rust
sources, build script, permissions, licenses, registry provenance and
`api-iife.js` remain. The build script uses that JavaScript asset for Tauri's
optional global API, so it is intentionally retained.

Re-evaluate this patch when the application's Tauri fork supports an upstream
updater release with ZIP 9 or newer. Keep the extraction regressions when removing
the dependency override.
