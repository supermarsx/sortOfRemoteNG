// NetBox per-crate sub-tab registry (t42 §4b, crate lead t42-netbox-L).
//
// The nested analogue of the top-level integrations registry: the panel shell
// (`NetboxPanel.tsx`) renders and routes its sub-tab bar from `netboxTabs`.
// Each category exec exports a `Netbox<Category>Tab` component; the per-crate
// integrator (the crate's last category exec) appends one `NetboxTabDescriptor`
// per category here. Category execs never edit each other's files, and the shell
// never changes per category — same disjoint-append discipline as §3.

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { NetboxTabProps } from "../../../types/netbox";

/** One registered category sub-tab. `importTab` is lazily loaded by the shell. */
export interface NetboxTabDescriptor {
  /** Stable category key, e.g. `"dcim"`. Used for tab routing. */
  categoryKey: string;
  /** i18n key for the tab label, e.g. `"integrations.netbox.dcim.title"`. */
  labelKey: string;
  /** English fallback label if the i18n key is missing. */
  labelDefault: string;
  /** Optional Lucide icon for the tab. */
  icon?: LucideIcon;
  /** Lazy import of the tab module (default-exported component). */
  importTab: () => Promise<{ default: ComponentType<NetboxTabProps> }>;
}

/** Registered NetBox category tabs, in display order. EMPTY at lead stage;
 *  category execs append via the per-crate integrator. */
export const netboxTabs: NetboxTabDescriptor[] = [
  {
    categoryKey: "dcim",
    labelKey: "integrations.netbox.dcim.title",
    labelDefault: "DCIM",
    importTab: () => import("./NetboxDcimTab"),
  },
  {
    categoryKey: "ipam",
    labelKey: "integrations.netbox.ipam.title",
    labelDefault: "IPAM",
    importTab: () => import("./NetboxIpamTab"),
  },
  {
    categoryKey: "virtualization",
    labelKey: "integrations.netbox.virtualization.title",
    labelDefault: "Virtualization & Circuits",
    importTab: () => import("./NetboxVirtualizationTab"),
  },
  {
    categoryKey: "tenancy",
    labelKey: "integrations.netbox.tenancy.title",
    labelDefault: "Tenancy & Contacts",
    importTab: () => import("./NetboxTenancyTab"),
  },
];
