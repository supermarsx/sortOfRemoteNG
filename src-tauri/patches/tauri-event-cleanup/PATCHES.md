# Tauri 2.11.5 event listener cleanup

This is the published Tauri 2.11.5 crate with the event cleanup change in `src/event/mod.rs` and exact private dependency requirements in `Cargo.toml` and `Cargo.toml.orig`. Its version and public API stay unchanged. Upstream licenses are included.

The published archive SHA-256 is `667b20e2726d572dea2de7370da16e188eb06008faf9a92fab7cdc46791190b5`, matching the previous Cargo.lock registry checksum. Source: [Tauri 2.11.5](https://github.com/tauri-apps/tauri/tree/tauri-v2.11.5/crates/tauri).

Upstream unregisters the callback without deleting the per-event JavaScript listener descriptor. A native event whose listener IDs were already queued can still find that descriptor and call the missing callback, producing `[TAURI] Couldn't find callback id ...` during session cleanup. The patch deletes the descriptor and unregisters its callback in the same JavaScript operation, so queued event delivery skips the retired ID. It also guards an absent entry, making repeated cleanup safe.

This does not suppress callback warnings or replace the invoke/channel machinery. The regression test compiles the actual Rust script generators, executes their output with the published Tauri core callback implementation, and verifies that a surviving listener still receives the queued event.

Run `node --test tests/tooling/tauriEventListenerCleanup.node-test.mjs` at the repository root. A native app rebuild is required because Tauri injects these scripts from the compiled Rust crate.

## Private dependency compatibility

The patched facade uses private runtime and generated-code APIs. Both manifests pin `tauri-runtime =2.11.3`, `tauri-runtime-wry =2.11.4`, `tauri-macros =2.6.3`, and `tauri-utils =2.9.3` (normal and build dependency) to the compatible cohort. A weekly update had selected runtime2.12.2/runtime-wry2.12.3/macros2.7.4/utils2.10.2, producing nineteen incompatible API errors. Other dependency requirements remain unchanged.

`SOURCE-MANIFEST.json` preserves the published archive hash and every upstream file hash, and records the two reviewed manifest postimages. The built-in-only source audit undoes exactly one comment and five `=` requirement changes in memory for each manifest, requires the full original upstream byte hash, and rejects extra edits. The updated Cargo candidate compiled successfully in run40371070058; its later PR delivery was denied by repository Actions permissions, so that run is not an overall success.
