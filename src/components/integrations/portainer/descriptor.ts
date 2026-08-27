// Portainer integration descriptor (t64).
//
// Lightweight module separate from the (heavy) panel so the registry can
// statically import the descriptor const WITHOUT eagerly bundling the panel —
// `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
//
// Category: the plan text says "infrastructure", which is not a member of
// `ConnectionTypeCategory`; the Docker-ish integrations (LXD, Proxmox, VMware)
// live under `virtualization`, so Portainer joins them there.

import { Container } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const portainerDescriptor: IntegrationDescriptor = {
  key: "portainer",
  label: "Portainer",
  category: "virtualization",
  icon: Container,
  defaultConnectionIconKey: "container",
  importPanel: () => import("./PortainerPanel"),
};
