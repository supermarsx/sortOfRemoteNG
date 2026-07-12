// Per-crate category registry for the mailcow panel (t42 §4b — the nested,
// intra-crate analogue of the top-level integrations registry).
//
// The panel shell (`MailcowPanel.tsx`) renders its sub-tab bar and routes tab
// content from this array. Category executors (t42-mailcow-c1/c2) DO NOT edit this
// file directly — the per-crate integrator appends their entry, exactly mirroring
// the disjoint-append discipline of the top-level category registries. The lead
// ships it EMPTY.

import type { ComponentType } from "react";

/** Props every mailcow sub-tab receives from the shell. The shell owns the
 *  connection lifecycle and only mounts a tab once connected, so `connectionId` is
 *  always a live mailcow connection id — pass it as the `id` arg to every
 *  `mailcow_*` command the tab invokes. Each tab manages its own domain/mailbox
 *  selection. */
export interface MailcowTabProps {
  connectionId: string;
}

/** One command-category slice of the mailcow surface (`objects` = domains/
 *  mailboxes/aliases provisioning vs `operations` = queue/quarantine/server).
 *  `label` may be an i18n key resolved at render time; a plain English string is
 *  the safe default. */
export interface MailcowCategoryTab {
  /** Stable key, e.g. `"objects"` / `"operations"`. Used for the active-tab state. */
  categoryKey: string;
  /** Human label (or i18n key). */
  label: string;
  /** Lazy import of the tab module; the shell wraps it in Suspense. */
  importTab: () => Promise<{ default: ComponentType<MailcowTabProps> }>;
}

/** Registered mailcow sub-tabs. EMPTY at lead time; the per-crate integrator
 *  appends `{ categoryKey, label, importTab }` for each category exec
 *  (`objects` = Domains, Mailboxes & Aliases, `operations` = Queue, Quarantine &
 *  Server). */
export const mailcowCategoryTabs: MailcowCategoryTab[] = [];
