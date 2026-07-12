// Per-crate category registry for the Ansible panel (t42 §4b — the nested,
// intra-crate analogue of the top-level integrations registry).
//
// The panel shell (`AnsiblePanel.tsx`) renders its sub-tab bar and routes tab
// content from this array. The category executor (t42-ansible-c1) DOES NOT edit
// this file directly — the per-crate integrator appends the entries, mirroring
// the disjoint-append discipline of the top-level category registries. The lead
// ships it EMPTY.

import type { ComponentType } from "react";

/** Props every Ansible sub-tab receives from the shell. The shell owns the
 *  connection lifecycle and only mounts a tab once connected, so `connectionId`
 *  is always a live Ansible control-node session id — pass it as the `id` arg to
 *  every `ansible_*` command the tab invokes. */
export interface AnsibleTabProps {
  connectionId: string;
}

/** One command-category slice of the Ansible surface (playbooks/runs/inventory/
 *  facts/history vs roles/galaxy/vault/config). `label` may be an i18n key
 *  resolved at render time; a plain English string is the safe default. */
export interface AnsibleCategoryTab {
  /** Stable key, e.g. `"runs"` / `"content"`. Used for the active-tab state. */
  categoryKey: string;
  /** Human label (or i18n key). */
  label: string;
  /** Lazy import of the tab module; the shell wraps it in Suspense. */
  importTab: () => Promise<{ default: ComponentType<AnsibleTabProps> }>;
}

/** Registered Ansible sub-tabs. EMPTY at lead time; the per-crate integrator
 *  appends `{ categoryKey, label, importTab }` for each category the executor
 *  builds. */
export const ansibleCategoryTabs: AnsibleCategoryTab[] = [];
