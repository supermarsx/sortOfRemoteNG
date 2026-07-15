// Integrations registry — the data-driven descriptor model that replaces the
// 5 hand-edited tool-enumeration sites for the Integrations hub (t42, §2/§3).
//
// Each integration exports an `IntegrationDescriptor` from its own panel module
// and appends it (via its wave integrator) to ONE per-category descriptor array
// (`registry.infra.ts`, `registry.web.ts`, ...). This file only concatenates
// those arrays, so the 32 downstream panel executors never touch a shared file —
// the disjoint-append trick (§3). Adding a category file here is the ONLY edit
// this module ever needs.

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { IntegrationConnectionSettings } from "../connection/connection";

import { infraIntegrations } from "./registry.infra";
import { webIntegrations } from "./registry.web";
import { databaseIntegrations } from "./registry.database";
import { appServiceIntegrations } from "./registry.appservice";
import { mailIntegrations } from "./registry.mail";
import { vaultIntegrations } from "./registry.vault";

/** Top-level grouping used by the hub to bucket integrations into sections. */
export type IntegrationCategory =
  | "infra"
  | "web"
  | "database"
  | "app-service"
  | "mail"
  | "vault";

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
  /** Which hub section this integration lives under. */
  category: IntegrationCategory;
  /** Lucide icon component rendered in the hub list + tabs. */
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
 *  group. Empty categories are omitted. Used by the hub to render sections. */
export function groupByCategory(
  descriptors: IntegrationDescriptor[] = integrationRegistry,
): { category: IntegrationCategory; items: IntegrationDescriptor[] }[] {
  const order: IntegrationCategory[] = [
    "infra",
    "web",
    "database",
    "app-service",
    "mail",
    "vault",
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
