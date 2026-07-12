// NetBox shared types — camelCase 1:1 mirror of the connection/pagination/common
// structs in `src-tauri/crates/sorng-netbox/src/types.rs` (serde
// `rename_all` is NOT set on those structs, but Tauri serializes struct fields
// as-is and the frontend uses camelCase; the invoke layer maps field names, so
// the wire shape is snake_case on the Rust side and these interfaces describe the
// camelCased view the panel consumes).
//
// This barrel owns ONLY the shell/shared types (connection config, summary,
// pagination, common nested refs/tags, and the tab-plugin props). Per-domain
// types (Site, Device, IpAddress, Vlan, Circuit, Tenant, ...) live in the
// category-exec files `src/types/netbox/<category>.ts`; each appends its own
// `export * from "./<category>"` line below (append-only, disjoint per §4b).

import type { ComponentType } from "react";

// ─── Connection ──────────────────────────────────────────────────────────────

/** Mirror of `NetboxConnectionConfig`. `apiToken` + `host` are required. */
export interface NetboxConnectionConfig {
  host: string;
  port?: number | null;
  useTls?: boolean | null;
  acceptInvalidCerts?: boolean | null;
  apiToken: string;
  timeoutSecs?: number | null;
}

/** Mirror of `NetboxConnectionSummary` — returned by `netbox_ping`. */
export interface NetboxConnectionSummary {
  host: string;
  version?: string | null;
  siteCount?: number | null;
  deviceCount?: number | null;
  prefixCount?: number | null;
}

// ─── Pagination ──────────────────────────────────────────────────────────────

/** Mirror of `PaginatedResponse<T>` — the shape of every NetBox list command. */
export interface PaginatedResponse<T> {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: T[];
}

// ─── Common nested references ────────────────────────────────────────────────

/** Mirror of `NestedRef`. */
export interface NestedRef {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
}

/** Mirror of `Tag`. */
export interface Tag {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  color?: string | null;
  description?: string | null;
}

// ─── Tab-plugin contract ─────────────────────────────────────────────────────

/** Props every NetBox category tab receives from the shell's sub-tab host. A tab
 *  is only mounted once the shell has an established connection, so
 *  `connectionId` is always a live id usable as the `id` arg to any `netbox_*`
 *  command. */
export interface NetboxTabProps {
  /** Live connection id (the `id` argument to every `netbox_*` command). */
  connectionId: string;
  /** Latest ping summary, if the shell has fetched one. */
  summary: NetboxConnectionSummary | null;
}

/** Convenience alias for a category tab component. */
export type NetboxTabComponent = ComponentType<NetboxTabProps>;

// ─── Per-category type modules (append-only; owned by category execs) ─────────
// e.g. `export * from "./dcim";`
