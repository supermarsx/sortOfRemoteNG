// Connection-type registry — the data-driven descriptor model that replaces the
// 5 hand-edited tool-enumeration sites (t42, §2/§3).
//
// Each entry exports an `IntegrationDescriptor` from its own panel module and
// appends it (via its wave integrator) to ONE descriptor array. This file only
// concatenates those arrays, so the downstream panel executors never touch a
// shared file — the disjoint-append trick (§3).
//
// ⚠️ The `registry.<name>.ts` filenames (`registry.infra.ts`, `registry.web.ts`,
// ...) are HISTORICAL. They are append-target arrays, NOT categories: they were
// named after the six-way `infra | web | database | app-service | mail | vault`
// split that `ConnectionTypeCategory` has since replaced, and their names now
// match no category. A descriptor's real category lives on its own `category`
// field — never infer it from which file the descriptor was appended to (t56 R2).

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { IntegrationConnectionSettings } from "../connection/connection";

import { infraIntegrations } from "./registry.infra";
import { webIntegrations } from "./registry.web";
import { databaseIntegrations } from "./registry.database";
import { appServiceIntegrations } from "./registry.appservice";
import { mailIntegrations } from "./registry.mail";
import { vaultIntegrations } from "./registry.vault";

/** The connection-type taxonomy — one axis over BOTH built-in protocols and
 *  integration-backed ones. Categories name what a thing *is* (a console, a
 *  mail server), not how it happens to be implemented; several of these
 *  (`console`, `lights-out`, `cloud`, `remote-desktop`) have no integrations at
 *  all and exist purely for built-in protocols. There is deliberately no
 *  "other" bucket. Display order is fixed by `groupByCategory` (t56 C1/C2). */
export type ConnectionTypeCategory =
  | "remote-desktop"
  | "console"
  | "lights-out"
  | "virtualization"
  | "networking"
  | "web-server"
  | "mail-server"
  | "database"
  | "file-storage"
  | "cloud"
  | "monitoring"
  | "vault"
  | "management"
  | "business-app";

/**
 * @deprecated Use {@link ConnectionTypeCategory}. Retained as an alias because
 * categories are no longer specific to integrations — they span built-in
 * protocols too.
 */
export type IntegrationCategory = ConnectionTypeCategory;

/** Props every integration panel receives from the panel host. `instanceId`
 *  identifies which persisted config instance to bind to (undefined = the
 *  panel's own "new / pick an instance" flow). */
export interface IntegrationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  instanceId?: string;
  /** Non-secret settings from the connection that launched this integration tab. */
  integrationSettings?: IntegrationConnectionSettings;
}

/** A single integration's registration record. One per crate/surface. */
export interface IntegrationDescriptor {
  /** Stable unique key, e.g. `"netbox"`. Used for routing + config namespacing. */
  key: string;
  /** Human label. Panels may pass an i18n key resolved at render time, but a
   *  plain English string is the safe default. */
  label: string;
  /** Which connection-type category this belongs to. The authoritative source
   *  of a descriptor's category — not the file it was appended to, and not any
   *  persisted copy on a saved connection. */
  category: ConnectionTypeCategory;
  /** Lucide icon component rendered in the panel list + tabs. */
  icon: LucideIcon;
  /**
   * Stable string key used as the default icon for saved connections backed
   * by this integration. Unlike `icon`, this value is persistence-safe and
   * can be resolved through the connection icon catalog.
   */
  defaultConnectionIconKey?: string;
  /** Lazy import of the panel module. Mirrors `dynamic(() => import(...))` in
   *  `ToolTabViewer`, but data-driven — the panel host awaits this. */
  importPanel: () => Promise<{ default: ComponentType<IntegrationPanelProps> }>;
}

/** The full registry — every registered integration across all categories.
 *  Order: infra → web → database → app-service → mail → vault. */
export const integrationRegistry: IntegrationDescriptor[] = [
  ...infraIntegrations,
  ...webIntegrations,
  ...databaseIntegrations,
  ...appServiceIntegrations,
  ...mailIntegrations,
  ...vaultIntegrations,
];

/** Descriptors grouped by category, preserving registration order within each
 *  group. Empty categories are omitted. Used to render category sections. */
export function groupByCategory(
  descriptors: IntegrationDescriptor[] = integrationRegistry,
): { category: ConnectionTypeCategory; items: IntegrationDescriptor[] }[] {
  // Display order (t56 C2). Consoles / Lights-Out / Networking rank high on
  // purpose. Every member of `ConnectionTypeCategory` MUST appear here: the
  // `.filter()` below would silently drop descriptors in a missing category.
  const order: ConnectionTypeCategory[] = [
    "remote-desktop",
    "console",
    "lights-out",
    "virtualization",
    "networking",
    "web-server",
    "mail-server",
    "database",
    "file-storage",
    "cloud",
    "monitoring",
    "vault",
    "management",
    "business-app",
  ];
  return order
    .map((category) => ({
      category,
      items: descriptors.filter((d) => d.category === category),
    }))
    .filter((group) => group.items.length > 0);
}

/** Look up a descriptor by its stable key. */
export function findDescriptor(key: string): IntegrationDescriptor | undefined {
  return integrationRegistry.find((d) => d.key === key);
}
