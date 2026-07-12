// Unified Mail Server integration hooks — barrel (t42 Wave M, lead t42-mail-L).
//
// Each of the 8 mail-chain crates is an independent daemon, so unlike the
// cpanel/php shells there is no shared connection hook here — every sub-tab owns
// its own `use<Crate>` (connect lifecycle + management) in a sibling file
// `./use<Crate>.ts`. Those re-exports are appended to the marked region below by
// the per-crate integrator.

// ── per-crate hook re-exports (appended by the per-crate integrator) ─────────
export {};
