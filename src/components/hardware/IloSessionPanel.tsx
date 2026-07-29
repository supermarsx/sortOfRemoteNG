import { iloRuntimeAdapter } from "../../utils/session/bmcRuntimeAdapters";
import type { BuiltInManagementSessionPanelProps } from "../../utils/session/builtInManagementRuntimeRegistry";
import { BmcSessionPanel } from "./BmcSessionPanel";

export function IloSessionPanel(props: BuiltInManagementSessionPanelProps) {
  return <BmcSessionPanel {...props} adapter={iloRuntimeAdapter} />;
}

export default IloSessionPanel;
