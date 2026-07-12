// LXD integration hooks barrel (t42).
//
// The LEAD owns the connection hook export. The per-crate integrator appends
// each category slice's `export * from "./useLxd<Category>"` line below the
// marker (disjoint-append discipline, §4b) — do not hand-edit those from a slice.
export * from "./useLxdConnection";

// ─── Category slice re-exports (append-only; per-crate integrator) ─────────────
// export * from "./useLxdInstances";
// export * from "./useLxdImages";
// export * from "./useLxdNetworking";
// export * from "./useLxdStorage";
