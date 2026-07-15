// mailcow integration descriptor (t42, crate lead t42-mailcow-L).
//
// Kept in a lightweight module separate from the (heavy) panel so the top-level
// registry can statically import the descriptor const WITHOUT eagerly bundling the
// panel — `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`). The
// Wave-3 app-service integrator appends `mailcowDescriptor` to
// `src/types/integrations/registry.appservice.ts`:
//   import { mailcowDescriptor } from "../../components/integrations/mailcow/descriptor";

import { Mailbox } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const mailcowDescriptor: IntegrationDescriptor = {
  key: "mailcow",
  label: "mailcow",
  category: "app-service",
  icon: Mailbox,
  defaultConnectionIconKey: "mailbox",
  importPanel: () => import("./MailcowPanel"),
};
