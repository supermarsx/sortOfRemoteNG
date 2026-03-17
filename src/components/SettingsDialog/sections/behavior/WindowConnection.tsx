import type { SectionProps } from "./types";
import React from "react";
import { AppWindow, Link, Monitor, RefreshCw, TextCursorInput } from "lucide-react";
import { Card, SectionHeader, Toggle } from "../../../ui/settings/SettingsPrimitives";
const WindowConnection: React.FC<SectionProps & { t: (k: string) => string }> =
  ({ s, u, t }) => (
    <div className="space-y-4">
      <SectionHeader
        icon={<AppWindow className="w-4 h-4 text-accent" />}
        title="Window & Connection"
      />
      <Card>
        <Toggle
          checked={s.singleWindowMode}
          onChange={(v) => u({ singleWindowMode: v })}
          icon={<AppWindow size={16} />}
          label="Disallow multiple instances"
          settingKey="singleWindowMode"
          infoTooltip="Prevent opening more than one instance of the application. If another instance is already running, the existing window will be focused instead."
        />
        <Toggle
          checked={s.singleConnectionMode}
          onChange={(v) => u({ singleConnectionMode: v })}
          icon={<Link size={16} />}
          label={t("connections.singleConnection")}
          description="Only one connection can be active at a time"
          settingKey="singleConnectionMode"
          infoTooltip="Restrict the application to one active connection at a time. Opening a new connection will close the current one first."
        />
        <Toggle
          checked={s.reconnectOnReload}
          onChange={(v) => u({ reconnectOnReload: v })}
          icon={<RefreshCw size={16} />}
          label={t("connections.reconnectOnReload")}
          description="Re-establish active sessions when the window reloads"
          settingKey="reconnectOnReload"
          infoTooltip="Automatically reconnect to all previously active sessions when the application window is reloaded or restarted."
        />
        <Toggle
          checked={s.enableAutocomplete}
          onChange={(v) => u({ enableAutocomplete: v })}
          icon={<TextCursorInput size={16} />}
          label="Enable browser autocomplete on input fields"
          description="Allow the browser to suggest previously entered values"
          settingKey="enableAutocomplete"
          infoTooltip="Allow the browser's built-in autocomplete to suggest previously entered values in input fields like hostnames and usernames."
        />
        <Toggle
          checked={s.enableWinrmTools}
          onChange={(v) => u({ enableWinrmTools: v })}
          icon={<Monitor size={16} />}
          label="Enable Windows Remote Management tools"
          description="Show WinRM toolbar buttons and context menu entries for Windows management tools"
          settingKey="enableWinrmTools"
          infoTooltip="When enabled, Windows management tools (Services, Processes, Event Viewer, etc.) are available in the context menu and RDP toolbar for Windows connections. Individual connections can override this setting."
        />
      </Card>
    </div>
  );

export default WindowConnection;
