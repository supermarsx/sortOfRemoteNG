// Per-crate category registry for the pfSense panel (t42 §4b — the nested,
// intra-crate analogue of the top-level integrations registry).
//
// The panel shell (`PfsensePanel.tsx`) renders its sub-tab bar and routes tab
// content from this array. Category executors (t42-pfsense-c1/c2) DO NOT edit
// this file directly — the per-crate integrator appends their entry, exactly
// mirroring the disjoint-append discipline of the top-level category registries.
// The lead ships it EMPTY.

import type { ComponentType } from "react";

/** Props every pfSense sub-tab receives from the shell. The shell owns the
 *  connection lifecycle and only mounts a tab once connected, so `connectionId`
 *  is always a live pfSense connection id — pass it as the `id` arg to every
 *  `pfsense_*` command the tab invokes. */
export interface PfsenseTabProps {
  connectionId: string;
}

/** One command-category slice of the pfSense surface (interfaces/firewall/nat/…
 *  vs dhcp/dns/services/…). `label` may be an i18n key resolved at render time;
 *  a plain English string is the safe default. */
export interface PfsenseCategoryTab {
  /** Stable key, e.g. `"network"` / `"services"`. Used for the active-tab state. */
  categoryKey: string;
  /** Human label (or i18n key). */
  label: string;
  /** Lazy import of the tab module; the shell wraps it in Suspense. */
  importTab: () => Promise<{ default: ComponentType<PfsenseTabProps> }>;
}

/** Registered pfSense sub-tabs. EMPTY at lead time; the per-crate integrator
 *  appends `{ categoryKey, label, importTab }` for each category exec. */
export const pfsenseCategoryTabs: PfsenseCategoryTab[] = [];
