// NetBox integration descriptor (t42, crate lead t42-netbox-L).
//
// Kept in a lightweight module separate from the (heavy) panel so the top-level
// registry can statically import the descriptor const WITHOUT eagerly bundling
// the panel — `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
// The Wave-1 infra integrator appends `netboxDescriptor` to
// `src/types/integrations/registry.infra.ts`:
//   import { netboxDescriptor } from "../../components/integrations/netbox/descriptor";

import { Network } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const netboxDescriptor: IntegrationDescriptor = {
  key: "netbox",
  label: "NetBox",
  category: "networking",
  icon: Network,
  defaultConnectionIconKey: "network",
  importPanel: () => import("./NetboxPanel"),
};
