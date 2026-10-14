# Tauri 2.11.5 event listener cleanup

This is the unmodified published Tauri 2.11.5 crate with one event cleanup change in `src/event/mod.rs`. Its version and public API stay unchanged. Upstream licenses are included.

The published archive SHA-256 is `667b20e2726d572dea2de7370da16e188eb06008faf9a92fab7cdc46791190b5`, matching the previous Cargo.lock registry checksum. Source: [Tauri 2.11.5](https://github.com/tauri-apps/tauri/tree/tauri-v2.11.5/crates/tauri).

Upstream unregisters the callback without deleting the per-event JavaScript listener descriptor. A native event whose listener IDs were already queued can still find that descriptor and call the missing callback, producing `[TAURI] Couldn't find callback id ...` during session cleanup. The patch deletes the descriptor and unregisters its callback in the same JavaScript operation, so queued event delivery skips the retired ID. It also guards an absent entry, making repeated cleanup safe.

This does not suppress callback warnings or replace the invoke/channel machinery. The regression test compiles the actual Rust script generators, executes their output with the published Tauri core callback implementation, and verifies that a surviving listener still receives the queued event.

Run `node --test tests/tooling/tauriEventListenerCleanup.node-test.mjs` at the repository root. A native app rebuild is required because Tauri injects these scripts from the compiled Rust crate.
