import { supermicroRuntimeAdapter } from "../../utils/session/bmcRuntimeAdapters";
import type { BuiltInManagementSessionPanelProps } from "../../utils/session/builtInManagementRuntimeRegistry";
import { BmcSessionPanel } from "./BmcSessionPanel";

export function SupermicroSessionPanel(
  props: BuiltInManagementSessionPanelProps,
) {
  return <BmcSessionPanel {...props} adapter={supermicroRuntimeAdapter} />;
}

export default SupermicroSessionPanel;
