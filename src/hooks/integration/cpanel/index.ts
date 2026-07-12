// cPanel/WHM integration hooks — barrel (t42 §4b, crate lead t42-cpanel-L).
//
// The connection lifecycle (cpanel_connect/disconnect/list_connections/ping) is
// owned by the shell and lives in `useCpanelConnection`. The per-category invoke
// slices + hooks (`useCpanelServer`, `useCpanelAccount`) are added by the
// category executors; their re-exports are appended to the marked region below
// by the per-crate integrator.

export * from "./useCpanelConnection";

// ── category hook re-exports (appended by the per-crate integrator) ──────────
export * from "./useCpanelServer";
export * from "./useCpanelAccount";
