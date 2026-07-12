// Per-crate category registry for the Jira panel (t42 §4b — the nested,
// intra-crate analogue of the top-level integrations registry).
//
// The panel shell (`JiraPanel.tsx`) renders its sub-tab bar and routes tab
// content from this array. Category executors (t42-jira-c1/c2) DO NOT edit this
// file directly — the per-crate integrator appends their entry, exactly
// mirroring the disjoint-append discipline of the top-level category registries.
// The lead ships it EMPTY.

import type { ComponentType } from "react";

/** Props every Jira sub-tab receives from the shell. The shell owns the
 *  connection lifecycle and only mounts a tab once connected, so `connectionId`
 *  is always a live Jira connection id — pass it as the `id` arg to every
 *  `jira_*` command the tab invokes. */
export interface JiraTabProps {
  connectionId: string;
}

/** One command-category slice of the Jira surface (`issues` = issues/comments/
 *  attachments/worklogs/users/fields; `agile` = projects/boards/sprints/
 *  dashboards/filters). `label` may be an i18n key resolved at render time; a
 *  plain English string is the safe default. */
export interface JiraCategoryTab {
  /** Stable key, e.g. `"issues"` / `"agile"`. Used for the active-tab state. */
  categoryKey: string;
  /** Human label (or i18n key). */
  label: string;
  /** Lazy import of the tab module; the shell wraps it in Suspense. */
  importTab: () => Promise<{ default: ComponentType<JiraTabProps> }>;
}

/** Registered Jira sub-tabs. EMPTY at lead time; the per-crate integrator
 *  appends `{ categoryKey, label, importTab }` for each category exec
 *  (`issues` = Issues, `agile` = Projects & Agile). */
export const jiraCategoryTabs: JiraCategoryTab[] = [
  {
    categoryKey: "issues",
    label: "Issues, Users & Fields",
    importTab: () => import("./JiraIssuesTab"),
  },
  {
    categoryKey: "agile",
    label: "Projects & Agile",
    importTab: () => import("./JiraAgileTab"),
  },
];
