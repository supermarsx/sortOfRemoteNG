// Proxmox VE integration descriptor (t67-e3).
//
// Lightweight module kept apart from the (heavy) panel so the registry can
// statically import the descriptor const without bundling the panel —
// `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`). Appended to
// `src/types/integrations/registry.infra.ts` by t67-e3.
//
// Editor mapping (generic integration fields only, see plans/t67.md §3 D1):
//   password auth: username `root@pam` (realm inside the username), password;
//   API token:     username `user@realm!tokenname`, apiKey = token secret.

import { Server } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const proxmoxDescriptor: IntegrationDescriptor = {
  key: "proxmox",
  label: "Proxmox VE",
  category: "virtualization",
  icon: Server,
  defaultConnectionIconKey: "server",
  importPanel: () => import("./ProxmoxIntegrationPanel"),
};
