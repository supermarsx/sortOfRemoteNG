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

## OPKSSH runtime prerequisites

The default includes `opkssh-vendored-wrapper`; development no longer removes that feature. Enabling it is not proof that an embedded Go runtime is installed. On Windows/MSVC, the Rust wrapper is deliberately metadata-only: embedded login requires the existing separately staged GNU bridge. The existing `npm run vendor:opkssh:build` workflow has its own Go/GNU-toolchain and pinned-upstream prerequisites. The supported OPKSSH CLI fallback still requires an installed CLI.

The managed development launcher preserves existing staged artifacts rather than replacing a real bridge with a metadata-only DLL. Production's existing vendor staging contract is unchanged. Neither compilation nor these feature tests are live-provider authentication proof.
