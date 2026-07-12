// osTicket integration descriptor (t42, crate lead t42-osticket-L).
//
// Kept in a lightweight module separate from the (heavy) panel so the top-level
// registry can statically import the descriptor const WITHOUT eagerly bundling
// the panel — `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
// The Wave-3 app-service integrator appends `osticketDescriptor` to
// `src/types/integrations/registry.appservice.ts`:
//   import { osticketDescriptor } from "../../components/integrations/osticket/descriptor";

import { LifeBuoy } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const osticketDescriptor: IntegrationDescriptor = {
  key: "osticket",
  label: "osTicket",
  category: "app-service",
  icon: LifeBuoy,
  importPanel: () => import("./OsticketPanel"),
};
