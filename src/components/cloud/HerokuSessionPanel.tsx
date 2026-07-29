import { herokuRuntimeAdapter } from "../../utils/session/cloudRuntimeAdapters";
import type { BuiltInCloudSessionPanelProps } from "../../utils/session/builtInCloudRuntimeRegistry";
import { CloudSessionPanel } from "./CloudSessionPanel";

export function HerokuSessionPanel(props: BuiltInCloudSessionPanelProps) {
  return <CloudSessionPanel {...props} adapter={herokuRuntimeAdapter} />;
}

export default HerokuSessionPanel;
