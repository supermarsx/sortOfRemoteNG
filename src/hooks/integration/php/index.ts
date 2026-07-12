// PHP-FPM integration hooks — barrel (t42 §4b, crate lead t42-php-L).
//
// The connection lifecycle (php_connect/disconnect/list_connections) is owned by
// the shell and lives in `usePhpConnection`. The per-category invoke slices +
// hooks (`usePhpRuntime`, `usePhpConfig`) are added by the category executors;
// their re-exports are appended to the marked region below by the per-crate
// integrator.

export * from "./usePhpConnection";

// ── category hook re-exports (appended by the per-crate integrator) ──────────
export * from "./usePhpRuntime";
export * from "./usePhpConfig";
