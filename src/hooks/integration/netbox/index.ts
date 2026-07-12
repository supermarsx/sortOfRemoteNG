// NetBox integration hooks barrel (t42, crate lead t42-netbox-L).
//
// Lead owns the connection-lifecycle export. Category execs append their own
// `export * from "./useNetbox<Category>"` lines below (append-only, disjoint).
export * from "./useNetboxConnection";

// ─── Per-category hook modules (append-only; owned by category execs) ─────────
// e.g. `export * from "./useNetboxDcim";`
