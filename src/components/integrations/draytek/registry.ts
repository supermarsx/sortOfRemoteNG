// Sub-tab registry for the DrayTek panel (t68 D3 — the intra-crate analogue
// of the pfSense `registry.ts`). The shell (`DrayTekPanel.tsx`) renders its
// sub-tab bar and routes tab content from this array; append-only.

import type { ComponentType } from "react";

/** What the shell knows about the connected device — handed to every tab so
 *  the Actions tab can build the web-admin URL. Credentials live in memory
 *  only (they are never persisted outside the OS vault). */
export interface DraytekDeviceContext {
  host: string;
  port: number;
  useTls: boolean;
  username: string;
  password: string;
  vendor: string;
}

/** Props every DrayTek sub-tab receives from the shell. The shell only mounts a
 *  tab once connected, so `connectionId` is always a live connection id — pass
 *  it as the `id` arg to every `draytek_*` command the tab invokes. */
export interface DraytekTabProps {
  connectionId: string;
  device: DraytekDeviceContext;
}

export interface DraytekCategoryTab {
  /** Stable key, e.g. `"status"` / `"actions"`. Used for the active-tab state. */
  categoryKey: string;
  /** Human label (English default; resolved through i18n at render time). */
  label: string;
  /** Lazy import of the tab module; the shell wraps it in Suspense. */
  importTab: () => Promise<{ default: ComponentType<DraytekTabProps> }>;
}

export const draytekCategoryTabs: DraytekCategoryTab[] = [
  {
    categoryKey: "status",
    label: "Status",
    importTab: () => import("./DrayTekStatusTab"),
  },
  {
    categoryKey: "actions",
    label: "Actions",
    importTab: () => import("./DrayTekActionsTab"),
  },
];
