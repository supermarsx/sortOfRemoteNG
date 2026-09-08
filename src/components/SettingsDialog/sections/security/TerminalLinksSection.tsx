import { ExternalLink } from "lucide-react";
import type { GlobalSettings } from "../../../../types/settings/settings";
import {
  Card,
  SettingsSectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

export default function TerminalLinksSection({
  settings,
  updateSettings,
}: {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}) {
  return (
    <div className="space-y-4">
      <SettingsSectionHeader
        icon={<ExternalLink className="w-4 h-4 text-primary" />}
        title="SSH terminal links"
      />
      <Card>
        <Toggle
          settingKey="allowSshExternalLinks"
          checked={settings.allowSshExternalLinks === true}
          onChange={(enabled) =>
            updateSettings({ allowSshExternalLinks: enabled })
          }
          icon={<ExternalLink size={16} />}
          label="Allow opening links from SSH sessions"
          description="Off by default. Allow only HTTP and HTTPS links to open in your browser. Terminal-provided (OSC8) links still ask you to confirm their actual destination."
          infoTooltip="An application-wide security policy, not a connection preference. Changes apply immediately to open SSH sessions. Connection profiles cannot override it. Other terminal protocols are unaffected by this SSH opt-in."
        />
      </Card>
    </div>
  );
}
