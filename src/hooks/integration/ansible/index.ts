// Ansible integration hooks — barrel (t42 §4b, crate lead t42-ansible-L).
//
// The connection lifecycle (ansible_connect/disconnect/list_connections/
// is_available/get_info) is owned by the shell via `useAnsibleConnection`. The
// per-category invoke slices + hooks (`useAnsibleRuns`, `useAnsibleContent`) are
// added by the category executor; their re-exports are appended to the marked
// region below by the per-crate integrator.

export * from "./useAnsibleConnection";

// ── category hook re-exports (wired by the Wave-2 integrator; no collisions) ──
export * from "./useAnsibleRuns";
export * from "./useAnsibleContent";
