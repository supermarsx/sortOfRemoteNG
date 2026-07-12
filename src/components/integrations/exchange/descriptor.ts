// Exchange integration descriptor (t42, crate lead t42-exchange-L).
//
// Kept in a lightweight module separate from the (heavy) panel so the top-level
// registry can statically import the descriptor const WITHOUT eagerly bundling
// the panel — `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
// The Wave-2 app-service integrator appends `exchangeDescriptor` to
// `src/types/integrations/registry.appservice.ts`:
//   import { exchangeDescriptor } from "../../components/integrations/exchange/descriptor";

import { Mail } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const exchangeDescriptor: IntegrationDescriptor = {
  key: "exchange",
  label: "Exchange",
  category: "app-service",
  icon: Mail,
  importPanel: () => import("./ExchangePanel"),
};
