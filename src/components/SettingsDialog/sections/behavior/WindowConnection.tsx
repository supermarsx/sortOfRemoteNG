import React from "react";
import { AppWindow, Link, RefreshCw, TextCursorInput } from "lucide-react";
import { Card, SectionHeader, Toggle } from "../../../ui/settings/SettingsPrimitives";
const WindowConnection: React.FC<SectionProps & { t: (k: string) => string }> =
  ({ s, u, t }) => (
    <div className="space-y-4">
      <SectionHeader
        icon={<AppWindow className="w-4 h-4 text-purple-400" />}
        title="Window & Connection"
      />
      <Card>
        <Toggle
          checked={s.singleWindowMode}
          onChange={(v) => u({ singleWindowMode: v })}
          icon={<AppWindow size={16} />}
          label="Disallow multiple instances"
          settingKey="singleWindowMode"
        />
        <Toggle
          checked={s.singleConnectionMode}
          onChange={(v) => u({ singleConnectionMode: v })}
          icon={<Link size={16} />}
          label={t("connections.singleConnection")}
          description="Only one connection can be active at a time"
          settingKey="singleConnectionMode"
        />
        <Toggle
          checked={s.reconnectOnReload}
          onChange={(v) => u({ reconnectOnReload: v })}
          icon={<RefreshCw size={16} />}
          label={t("connections.reconnectOnReload")}
          description="Re-establish active sessions when the window reloads"
          settingKey="reconnectOnReload"
        />
        <Toggle
          checked={s.enableAutocomplete}
          onChange={(v) => u({ enableAutocomplete: v })}
          icon={<TextCursorInput size={16} />}
          label="Enable browser autocomplete on input fields"
          description="Allow the browser to suggest previously entered values"
          settingKey="enableAutocomplete"
        />
      </Card>
    </div>
  );

export default WindowConnection;
