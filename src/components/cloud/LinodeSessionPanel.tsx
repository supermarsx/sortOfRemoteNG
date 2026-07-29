import { linodeRuntimeAdapter } from "../../utils/session/cloudRuntimeAdapters";
import type { BuiltInCloudSessionPanelProps } from "../../utils/session/builtInCloudRuntimeRegistry";
import { CloudSessionPanel } from "./CloudSessionPanel";

export function LinodeSessionPanel(props: BuiltInCloudSessionPanelProps) {
  return <CloudSessionPanel {...props} adapter={linodeRuntimeAdapter} />;
}

export default LinodeSessionPanel;
