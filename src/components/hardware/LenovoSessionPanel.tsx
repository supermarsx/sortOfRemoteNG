import { lenovoRuntimeAdapter } from "../../utils/session/bmcRuntimeAdapters";
import type { BuiltInManagementSessionPanelProps } from "../../utils/session/builtInManagementRuntimeRegistry";
import { BmcSessionPanel } from "./BmcSessionPanel";

export function LenovoSessionPanel(props: BuiltInManagementSessionPanelProps) {
  return <BmcSessionPanel {...props} adapter={lenovoRuntimeAdapter} />;
}

export default LenovoSessionPanel;
