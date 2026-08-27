// Nginx Proxy Manager integration descriptor (t65).
//
// Lightweight module separate from the (heavy) panel so the registry can
// statically import the descriptor const WITHOUT eagerly bundling the panel —
// `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
// Appended to `src/types/integrations/registry.web.ts` so NPM shows up in the
// connection-type picker next to Nginx / Traefik.

import { Waypoints } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const nginxProxyMgrDescriptor: IntegrationDescriptor = {
  key: "nginxProxyMgr",
  label: "Nginx Proxy Manager",
  category: "web-server",
  icon: Waypoints,
  defaultConnectionIconKey: "waypoints",
  importPanel: () => import("./NginxProxyMgrPanel"),
};
