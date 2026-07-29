import { azureRuntimeAdapter } from "../../utils/session/cloudRuntimeAdapters";
import type { BuiltInCloudSessionPanelProps } from "../../utils/session/builtInCloudRuntimeRegistry";
import { CloudSessionPanel } from "./CloudSessionPanel";

export function AzureSessionPanel(props: BuiltInCloudSessionPanelProps) {
  return <CloudSessionPanel {...props} adapter={azureRuntimeAdapter} />;
}

export default AzureSessionPanel;
