// NetBox Tenancy & Contacts domain types (t42-netbox-c4).
//
// camelCase 1:1 mirror of the Tenancy/Contacts structs in
// `src-tauri/crates/sorng-netbox/src/types.rs` (Tenant, TenantGroup, Contact,
// ContactGroup, ContactRole, ContactAssignment). Nested `serde_json::Value`
// fields that carry a nested object reference on the wire are typed as
// `NestedRef`; opaque bags (custom fields) are `Record<string, unknown>`.
//
// Shared primitives (NestedRef, Tag, PaginatedResponse) come from the shell
// barrel `../netbox`. This module is disjoint from the other category type
// modules and owns only the `tenancy` domain.

import type { NestedRef, Tag } from "./index";

// ─── Tenants ──────────────────────────────────────────────────────────────────

/** Mirror of `Tenant`. */
export interface Tenant {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  /** Owning tenant group (nested ref). */
  group?: NestedRef | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: Record<string, unknown> | null;
  created?: string | null;
  lastUpdated?: string | null;
}

/** Mirror of `TenantGroup`. */
export interface TenantGroup {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  /** Parent group (nested ref) for nested hierarchies. */
  parent?: NestedRef | null;
  description?: string | null;
  tags?: Tag[] | null;
  tenantCount?: number | null;
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

/** Mirror of `Contact`. */
export interface Contact {
  id?: number | null;
  url?: string | null;
  /** Owning contact group (nested ref). */
  group?: NestedRef | null;
  name?: string | null;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  link?: string | null;
  description?: string | null;
  comments?: string | null;
  tags?: Tag[] | null;
  customFields?: Record<string, unknown> | null;
  created?: string | null;
  lastUpdated?: string | null;
}

/** Mirror of `ContactGroup`. */
export interface ContactGroup {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  /** Parent group (nested ref) for nested hierarchies. */
  parent?: NestedRef | null;
  description?: string | null;
  tags?: Tag[] | null;
  contactCount?: number | null;
}

/** Mirror of `ContactRole`. */
export interface ContactRole {
  id?: number | null;
  url?: string | null;
  name?: string | null;
  slug?: string | null;
  description?: string | null;
  tags?: Tag[] | null;
}

/** Mirror of `ContactAssignment` — links a contact to any NetBox object. */
export interface ContactAssignment {
  id?: number | null;
  url?: string | null;
  objectType?: string | null;
  objectId?: number | null;
  /** The assigned-to object (nested ref). */
  object?: NestedRef | null;
  /** The assigned contact (nested ref). */
  contact?: NestedRef | null;
  /** The contact role (nested ref). */
  role?: NestedRef | null;
  /** Priority choice `{ value, label }`. */
  priority?: { value?: string | null; label?: string | null } | null;
  created?: string | null;
  lastUpdated?: string | null;
}
