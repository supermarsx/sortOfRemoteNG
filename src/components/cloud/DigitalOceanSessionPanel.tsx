import { digitalOceanRuntimeAdapter } from "../../utils/session/cloudRuntimeAdapters";
import type { BuiltInCloudSessionPanelProps } from "../../utils/session/builtInCloudRuntimeRegistry";
import { CloudSessionPanel } from "./CloudSessionPanel";

export function DigitalOceanSessionPanel(
  props: BuiltInCloudSessionPanelProps,
) {
  return <CloudSessionPanel {...props} adapter={digitalOceanRuntimeAdapter} />;
}

export default DigitalOceanSessionPanel;
