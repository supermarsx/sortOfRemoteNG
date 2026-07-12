// mailcow integration hooks — barrel (t42 §4b, crate lead t42-mailcow-L).
//
// The connection lifecycle (mailcow_connect/disconnect/list_connections/ping) is
// owned by the shell and lives in `useMailcowConnection`. The per-category invoke
// slices + hooks (`useMailcowObjects`, `useMailcowOperations`) are added by the
// category executors; their re-exports are appended to the marked region below by
// the per-crate integrator.

export * from "./useMailcowConnection";

// ── category hook re-exports (appended by the per-crate integrator) ──────────
// export * from "./useMailcowObjects";
// export * from "./useMailcowOperations";
