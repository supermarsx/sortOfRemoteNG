// Per-crate sub-tab registry for the VMware Workstation panel (t42, §4b).
//
// The panel shell (`VmwareDesktopPanel.tsx`) renders its sub-tab bar and lazily
// loads the active tab from this array — the disjoint-append trick one level down
// from the top-level integrations registry. The LEAD writes this empty; each
// category exec's tab is appended here by the per-crate integrator (folded into
// the last category exec, or the lead re-invoked). Category execs do NOT edit
// this file directly. Keep it append-only; do not reorder existing entries.
import type { VmwDesktopTabDescriptor } from "../../../types/vmwareDesktop";

export const vmwDesktopTabs: VmwDesktopTabDescriptor[] = [];
