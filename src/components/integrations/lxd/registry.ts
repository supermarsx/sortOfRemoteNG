// Per-crate category registry for the LXD panel (t42 §4b).
//
// The panel shell (`LxdPanel.tsx`) renders and routes its sub-tab bar from this
// array — one entry per command-category slice (instances, images, networking,
// storage). It starts EMPTY; each category executor's slice is appended here by
// the per-crate integrator, exactly mirroring the top-level Integrations
// registry disjoint-append trick. Category executors NEVER edit this file
// directly — they only export their tab component; the integrator wires it in.

import type { ComponentType } from "react";

/** Props every LXD sub-tab receives from the panel shell. The active connection
 *  is global (held in the backend LxdService state), so a tab only needs to know
 *  whether it may issue commands; it instantiates its own category hook. */
export interface LxdTabProps {
  /** True once `lxd_connect` has succeeded — tabs gate their fetches on this. */
  connected: boolean;
  /** The persisted instance id backing this panel, if any (for future per-tab
   *  preferences; tabs may ignore it). */
  instanceId?: string;
}

/** One command-category slice registered into the LXD panel's sub-tab bar. */
export interface LxdCategoryDescriptor {
  /** Stable key, e.g. `"instances"`. Also the i18n subtree + tab id. */
  categoryKey: string;
  /** i18n key for the tab label. */
  labelKey: string;
  /** English fallback label if the i18n key is missing. */
  labelDefault: string;
  /** Lazy import of the tab component module. */
  importTab: () => Promise<{ default: ComponentType<LxdTabProps> }>;
}

/** The LXD sub-tab registry. EMPTY at lead time; category slices are appended by
 *  the per-crate integrator. Order defines tab order. */
export const lxdCategories: LxdCategoryDescriptor[] = [];
