// Jira integration descriptor (t42, crate lead t42-jira-L).
//
// Kept in a lightweight module separate from the (heavy) panel so the top-level
// registry can statically import the descriptor const WITHOUT eagerly bundling
// the panel — `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
// The Wave-3 app-service integrator appends `jiraDescriptor` to
// `src/types/integrations/registry.appservice.ts`:
//   import { jiraDescriptor } from "../../components/integrations/jira/descriptor";

import { SquareKanban } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const jiraDescriptor: IntegrationDescriptor = {
  key: "jira",
  label: "Jira",
  category: "app-service",
  icon: SquareKanban,
  defaultConnectionIconKey: "kanban",
  importPanel: () => import("./JiraPanel"),
};
