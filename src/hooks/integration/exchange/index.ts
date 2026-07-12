// Exchange integration hooks barrel (t42, crate lead t42-exchange-L).
//
// Lead owns the connection-lifecycle export. Category execs append their own
// named re-exports below (append-only, disjoint).
export * from "./useExchangeConnection";

// ─── Per-category hook modules (append-only; owned by category execs) ─────────
// Named re-exports (NOT `export *`) so category-specific request types that share
// a name across slices don't collide — import those from the per-category module
// or the types barrel directly. Category execs (c1..c5) add:
//   export { exchangeRecipientsApi, useExchangeRecipients } from "./useExchangeRecipients";
//   export { exchangeMailflowApi, useExchangeMailflow } from "./useExchangeMailflow";
//   export { exchangeServersApi, useExchangeServers } from "./useExchangeServers";
//   export { exchangeClientAccessApi, useExchangeClientAccess } from "./useExchangeClientAccess";
//   export { exchangeOrgSecurityApi, useExchangeOrgSecurity } from "./useExchangeOrgSecurity";
