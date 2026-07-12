// NetBox integration hooks barrel (t42, crate lead t42-netbox-L).
//
// Lead owns the connection-lifecycle export. Category execs append their own
// `export * from "./useNetbox<Category>"` lines below (append-only, disjoint).
export * from "./useNetboxConnection";

// ─── Per-category hook modules (append-only; owned by category execs) ─────────
// Named re-exports (not `export *`) so category-specific request types that
// share a name (e.g. NetboxListParams) don't collide — import those from the
// per-category module or the types barrel directly.
export { netboxDcimApi, useNetboxDcim } from "./useNetboxDcim";
export { netboxIpamApi, useNetboxIpam } from "./useNetboxIpam";
export {
  netboxVirtualizationApi,
  useNetboxVirtualization,
} from "./useNetboxVirtualization";
export { netboxTenancyApi, useNetboxTenancy } from "./useNetboxTenancy";
