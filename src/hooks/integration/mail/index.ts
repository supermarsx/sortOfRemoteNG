// Unified Mail Server integration hooks — barrel (t42 Wave M, lead t42-mail-L).
//
// Each mail service is independently connected, so unlike the
// cpanel/php shells there is no shared connection hook here — every sub-tab owns
// its own `use<Crate>` (connect lifecycle + management) in a sibling file
// `./use<Crate>.ts`.

// ── per-crate hook re-exports (appended by the per-crate integrator) ─────────
export * from "./useOpendkim";
export * from "./useProcmail";
export * from "./useRspamd";
export * from "./useClamav";
export * from "./usePostfix";
export * from "./useDovecot";
export * from "./useAmavis";
export * from "./useCyrusSasl";
export * from "./useRoundcube";
