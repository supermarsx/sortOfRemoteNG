import type { SectionProps } from "./types";
import React from "react";
import { RefreshCw, Wifi, Bell } from "lucide-react";
import { Card, SectionHeader, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const ReconnectionSection: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Wifi className="w-4 h-4 text-sky-400" />}
      title="Reconnection"
    />
    <Card>
      <Toggle
        checked={s.autoReconnectOnDisconnect}
        onChange={(v) => u({ autoReconnectOnDisconnect: v })}
        icon={<RefreshCw size={16} />}
        label="Auto-reconnect on unexpected disconnect"
        description="Attempt to re-establish the connection if it drops"
        settingKey="autoReconnectOnDisconnect"
        infoTooltip="Automatically attempt to re-establish a connection when it is unexpectedly lost, such as due to network issues or server restarts."
      />
      {s.autoReconnectOnDisconnect && (
        <>
          <SliderRow
            label="Max attempts"
            value={s.autoReconnectMaxAttempts}
            min={0}
            max={50}
            onChange={(v) => u({ autoReconnectMaxAttempts: v })}
            settingKey="autoReconnectMaxAttempts"
            infoTooltip="Maximum number of reconnection attempts before giving up. Set to 0 for unlimited attempts."
          />
          <div className="text-[10px] text-[var(--color-textMuted)] pl-1">
            {s.autoReconnectMaxAttempts === 0
              ? "Unlimited attempts"
              : `Up to ${s.autoReconnectMaxAttempts} attempts`}
          </div>
          <SliderRow
            label="Delay between attempts"
            value={s.autoReconnectDelaySecs}
            min={1}
            max={60}
            unit="s"
            onChange={(v) => u({ autoReconnectDelaySecs: v })}
            settingKey="autoReconnectDelaySecs"
            infoTooltip="Number of seconds to wait between each reconnection attempt. Longer delays reduce server load but take more time to recover."
          />
        </>
      )}
      <Toggle
        checked={s.notifyOnReconnect}
        onChange={(v) => u({ notifyOnReconnect: v })}
        icon={<Bell size={16} />}
        label="Notify on successful reconnect"
        description="Show a notification when a dropped session is restored"
        settingKey="notifyOnReconnect"
        infoTooltip="Display a notification when an automatically reconnected session is successfully restored, so you know the connection is back."
      />
    </Card>
  </div>
);

export default ReconnectionSection;
