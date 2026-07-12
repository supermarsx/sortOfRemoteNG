// Per-crate category registry for the osTicket panel (t42 §4b — the nested,
// intra-crate analogue of the top-level integrations registry).
//
// The panel shell (`OsticketPanel.tsx`) renders its sub-tab bar and routes tab
// content from this array. Category executors (t42-osticket-c1/c2) DO NOT edit
// this file directly — the per-crate integrator appends their entry, exactly
// mirroring the disjoint-append discipline of the top-level category registries.
// The lead ships it EMPTY.

import type { ComponentType } from "react";

/** Props every osTicket sub-tab receives from the shell. The shell owns the
 *  connection lifecycle and only mounts a tab once connected, so `connectionId`
 *  is always a live osTicket connection id — pass it as the `id` arg to every
 *  `osticket_*` command the tab invokes. */
export interface OsticketTabProps {
  connectionId: string;
}

/** One command-category slice of the osTicket surface (`ticketing` = ticket
 *  lifecycle + requester users; `admin` = departments/topics/agents/teams/sla/
 *  canned-responses/custom-fields). `label` may be an i18n key resolved at render
 *  time; a plain English string is the safe default. */
export interface OsticketCategoryTab {
  /** Stable key, e.g. `"ticketing"` / `"admin"`. Used for the active-tab state. */
  categoryKey: string;
  /** Human label (or i18n key). */
  label: string;
  /** Lazy import of the tab module; the shell wraps it in Suspense. */
  importTab: () => Promise<{ default: ComponentType<OsticketTabProps> }>;
}

/** Registered osTicket sub-tabs. EMPTY at lead time; the per-crate integrator
 *  appends `{ categoryKey, label, importTab }` for each category exec
 *  (`ticketing` = Ticketing, `admin` = Administration). */
export const osticketCategoryTabs: OsticketCategoryTab[] = [];
