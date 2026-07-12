// osTicket integration hooks — barrel (t42 §4b, crate lead t42-osticket-L).
//
// The connection lifecycle (osticket_connect/disconnect/list_connections/ping) is
// owned by the shell and lives in `useOsticketConnection`. The per-category invoke
// slices + hooks (`useOsticketTicketing`, `useOsticketAdmin`) are added by the
// category executors; their re-exports are appended to the marked region below by
// the per-crate integrator.

export * from "./useOsticketConnection";

// ── category hook re-exports (appended by the per-crate integrator) ──────────
export * from "./useOsticketTicketing";
export * from "./useOsticketAdmin";
