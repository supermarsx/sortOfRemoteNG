import { ibmCloudRuntimeAdapter } from "../../utils/session/cloudRuntimeAdapters";
import type { BuiltInCloudSessionPanelProps } from "../../utils/session/builtInCloudRuntimeRegistry";
import { CloudSessionPanel } from "./CloudSessionPanel";

export function IbmCloudSessionPanel(props: BuiltInCloudSessionPanelProps) {
  return <CloudSessionPanel {...props} adapter={ibmCloudRuntimeAdapter} />;
}

export default IbmCloudSessionPanel;
