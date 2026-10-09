import type { WebBrowserSettingsConfig } from "../../../../types/settings/webBrowser";
import { Toggle } from "../../../ui/settings/SettingsPrimitives";

export function BrowserXsltSettings({
  config,
  onChange,
}: {
  config: WebBrowserSettingsConfig;
  onChange: (change: Partial<WebBrowserSettingsConfig>) => void;
}) {
  return (
    <Toggle
      settingKey="webBrowser.xsltEnabled"
      label="Enable XSLT"
      description="Allow XML stylesheet transformations in the native browser. Some legacy portals, including RD Web Access, need this. Applies to all native browser connections after restarting the app; the legacy engine is controlled by its system WebView. Network permissions and certificate checks are unchanged."
      checked={config.xsltEnabled !== false}
      onChange={(xsltEnabled) => onChange({ xsltEnabled })}
    />
  );
}
