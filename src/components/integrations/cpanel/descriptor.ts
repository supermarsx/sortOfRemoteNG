// cPanel/WHM integration descriptor (t42, crate lead t42-cpanel-L).
//
// Kept in a lightweight module separate from the (heavy) panel so the top-level
// registry can statically import the descriptor const WITHOUT eagerly bundling
// the panel — `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
// The Wave-2 infra integrator appends `cpanelDescriptor` to
// `src/types/integrations/registry.infra.ts`:
//   import { cpanelDescriptor } from "../../components/integrations/cpanel/descriptor";

import { Server } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const cpanelDescriptor: IntegrationDescriptor = {
  key: "cpanel",
  label: "cPanel/WHM",
  category: "infra",
  icon: Server,
  importPanel: () => import("./CpanelPanel"),
};
