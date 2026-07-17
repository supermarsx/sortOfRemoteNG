// Ansible integration descriptor (t42, crate lead t42-ansible-L).
//
// Kept in a lightweight module separate from the (heavy) panel so the top-level
// registry can statically import the descriptor const WITHOUT eagerly bundling
// the panel — `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
// The Wave-2 infra integrator appends `ansibleDescriptor` to
// `src/types/integrations/registry.infra.ts`:
//   import { ansibleDescriptor } from "../../components/integrations/ansible/descriptor";

import { ServerCog } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const ansibleDescriptor: IntegrationDescriptor = {
  key: "ansible",
  label: "Ansible",
  category: "management",
  icon: ServerCog,
  defaultConnectionIconKey: "server-cog",
  importPanel: () => import("./AnsiblePanel"),
};
