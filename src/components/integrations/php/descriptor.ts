// PHP-FPM integration descriptor (t42, crate lead t42-php-L).
//
// Kept in a lightweight module separate from the (heavy) panel so the top-level
// registry can statically import the descriptor const WITHOUT eagerly bundling
// the panel — `importPanel` stays lazy (React.lazy in `IntegrationPanelHost`).
// The Wave-4 web integrator appends `phpDescriptor` to
// `src/types/integrations/registry.web.ts`:
//   import { phpDescriptor } from "../../components/integrations/php/descriptor";

import { FileCode2 } from "lucide-react";
import type { IntegrationDescriptor } from "../../../types/integrations/registry";

export const phpDescriptor: IntegrationDescriptor = {
  key: "php",
  label: "PHP-FPM",
  category: "web",
  icon: FileCode2,
  defaultConnectionIconKey: "file-code",
  importPanel: () => import("./PhpPanel"),
};
