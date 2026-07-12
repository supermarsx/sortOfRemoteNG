// pfSense integration hooks — barrel (t42 §4b, crate lead t42-pfsense-L).
//
// The connection lifecycle (pfsense_connect/disconnect/list_connections/ping)
// is owned by the shell and lives in `PfsensePanel.tsx`. The per-category invoke
// slices + hooks (`usePfsenseNetwork`, `usePfsenseServices`) are added by the
// category executors; their re-exports are appended to the marked region below
// by the per-crate integrator.

export {};

// ── category hook re-exports (appended by the per-crate integrator) ──────────
// export * from "./usePfsenseNetwork";
// export * from "./usePfsenseServices";
