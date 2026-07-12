// Per-crate category registry for the cPanel/WHM panel (t42 §4b — the nested,
// intra-crate analogue of the top-level integrations registry).
//
// The panel shell (`CpanelPanel.tsx`) renders its sub-tab bar and routes tab
// content from this array. Category executors (t42-cpanel-c1/c2) DO NOT edit
// this file directly — the per-crate integrator appends their entry, exactly
// mirroring the disjoint-append discipline of the top-level category registries.
// The lead ships it EMPTY.

import type { ComponentType } from "react";

/** Props every cPanel/WHM sub-tab receives from the shell. The shell owns the
 *  connection lifecycle and only mounts a tab once connected, so `connectionId`
 *  is always a live cPanel/WHM connection id — pass it as the `id` arg to every
 *  `cpanel_*` command the tab invokes. Account-scope commands additionally take a
 *  cPanel account `user`; each tab manages its own account selection. */
export interface CpanelTabProps {
  connectionId: string;
}

/** One command-category slice of the cPanel/WHM surface (WHM server-admin
 *  vs cPanel account-level). `label` may be an i18n key resolved at render time;
 *  a plain English string is the safe default. */
export interface CpanelCategoryTab {
  /** Stable key, e.g. `"server"` / `"account"`. Used for the active-tab state. */
  categoryKey: string;
  /** Human label (or i18n key). */
  label: string;
  /** Lazy import of the tab module; the shell wraps it in Suspense. */
  importTab: () => Promise<{ default: ComponentType<CpanelTabProps> }>;
}

/** Registered cPanel/WHM sub-tabs. EMPTY at lead time; the per-crate integrator
 *  appends `{ categoryKey, label, importTab }` for each category exec
 *  (`server` = WHM / Server Administration, `account` = cPanel Account Services). */
export const cpanelCategoryTabs: CpanelCategoryTab[] = [
  {
    categoryKey: "server",
    label: "WHM / Server Administration",
    importTab: () => import("./CpanelServerTab"),
  },
  {
    categoryKey: "account",
    label: "cPanel Account Services",
    importTab: () => import("./CpanelAccountTab"),
  },
];
