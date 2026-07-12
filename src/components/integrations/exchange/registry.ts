// Exchange per-crate sub-tab registry (t42 §4b, crate lead t42-exchange-L).
//
// The nested analogue of the top-level integrations registry: the panel shell
// (`ExchangePanel.tsx`) renders and routes its sub-tab bar from `exchangeTabs`.
// Each category exec exports an `Exchange<Category>Tab` component; the per-crate
// integrator (the crate's last category exec, or the lead re-invoked) appends one
// `ExchangeTabDescriptor` per category here. Category execs never edit each other's
// files, and the shell never changes per category — same disjoint-append discipline
// as §3.

import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { ExchangeTabProps } from "../../../types/exchange";

// Re-export the tab-props contract so category tabs can import it from the registry
// (mirrors netbox) without reaching into the types barrel.
export type { ExchangeTabProps } from "../../../types/exchange";

/** One registered category sub-tab. `importTab` is lazily loaded by the shell. */
export interface ExchangeTabDescriptor {
  /** Stable category key, e.g. `"recipients"`. Used for tab routing. */
  categoryKey: string;
  /** i18n key for the tab label, e.g. `"integrations.exchange.recipients.title"`. */
  labelKey: string;
  /** English fallback label if the i18n key is missing. */
  labelDefault: string;
  /** Optional Lucide icon for the tab. */
  icon?: LucideIcon;
  /** Lazy import of the tab module (default-exported component). */
  importTab: () => Promise<{ default: ComponentType<ExchangeTabProps> }>;
}

/** Registered Exchange category tabs, in display order. Wired by the Wave-2
 *  integrator (recipients → mailflow → servers → clientaccess → orgsecurity). */
export const exchangeTabs: ExchangeTabDescriptor[] = [
  {
    categoryKey: "recipients",
    labelKey: "integrations.exchange.recipients.title",
    labelDefault: "Recipients & Mailboxes",
    importTab: () => import("./ExchangeRecipientsTab"),
  },
  {
    categoryKey: "mailflow",
    labelKey: "integrations.exchange.mailflow.title",
    labelDefault: "Transport & Mail Flow",
    importTab: () => import("./ExchangeMailflowTab"),
  },
  {
    categoryKey: "servers",
    labelKey: "integrations.exchange.servers.title",
    labelDefault: "Servers, Databases & Migration",
    importTab: () => import("./ExchangeServersTab"),
  },
  {
    categoryKey: "clientaccess",
    labelKey: "integrations.exchange.clientaccess.title",
    labelDefault: "Client Access & Protocols",
    importTab: () => import("./ExchangeClientAccessTab"),
  },
  {
    categoryKey: "orgsecurity",
    labelKey: "integrations.exchange.orgsecurity.title",
    labelDefault: "Org Config, Security & Compliance",
    importTab: () => import("./ExchangeOrgSecurityTab"),
  },
];
