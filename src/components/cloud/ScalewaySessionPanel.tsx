import { scalewayRuntimeAdapter } from "../../utils/session/cloudRuntimeAdapters";
import type { BuiltInCloudSessionPanelProps } from "../../utils/session/builtInCloudRuntimeRegistry";
import { CloudSessionPanel } from "./CloudSessionPanel";

export function ScalewaySessionPanel(props: BuiltInCloudSessionPanelProps) {
  return <CloudSessionPanel {...props} adapter={scalewayRuntimeAdapter} />;
}

export default ScalewaySessionPanel;
