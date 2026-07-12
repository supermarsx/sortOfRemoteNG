// Per-crate sub-tab registry for the KeePass panel (t42 §4b).
//
// The KeepassPanel shell renders + routes its sub-tabs from this array — the
// intra-crate analogue of the top-level integrations registry. This is the ONLY
// shared file inside the crate: the lead writes the initial EMPTY array, and each
// category exec's descriptor is appended by the per-crate integrator (folded into
// the last category exec), so no two category execs edit the same file.
//
// Category execs append (disjoint-append discipline):
//   keepassTabs.push({ categoryKey: "database", labelKey: "...", labelDefault: "...",
//     importTab: () => import("./KeepassDatabaseTab") });  // c1
//   keepassTabs.push({ categoryKey: "tools", ... importTab: () => import("./KeepassToolsTab") }); // c2

import type { ComponentType } from "react";

/** Props every KeePass sub-tab receives from the shell once a database is open. */
export interface KeepassTabProps {
  /** The id of the currently-open KeePass database session (`KeePassDatabase.id`). */
  dbId: string;
}

/** One registered sub-tab (= one command category). */
export interface KeepassTabDescriptor {
  /** Stable key, e.g. `"database"` / `"tools"`. Used for routing + test ids. */
  categoryKey: string;
  /** i18n key for the tab label. */
  labelKey: string;
  /** English fallback passed as the second arg to `t()`. */
  labelDefault: string;
  /** Lazy import of the tab component. */
  importTab: () => Promise<{ default: ComponentType<KeepassTabProps> }>;
}

/** The registered sub-tabs, in tab-bar order. Appended by the per-crate
 *  integrator (t42-keepass-L) once each category exec lands its tab. */
export const keepassTabs: KeepassTabDescriptor[] = [
  {
    categoryKey: "database",
    labelKey: "integrations.keepass.database.tabLabel",
    labelDefault: "Database & Data Model",
    importTab: () => import("./KeepassDatabaseTab"),
  },
  {
    categoryKey: "tools",
    labelKey: "integrations.keepass.tools.tabLabel",
    labelDefault: "Tools & Security",
    importTab: () => import("./KeepassToolsTab"),
  },
];
