import type { SectionProps } from "./types";
import React from "react";
import { RefreshCw, Wifi, Bell } from "lucide-react";
import {
  Card,
  SectionHeader,
  SelectRow,
  SliderRow,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
const ReconnectionSection: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Wifi className="w-4 h-4 text-primary" />}
      title="Reconnection"
    />
    <Card>
      <Toggle
        checked={s.autoReconnectOnDisconnect}
        onChange={(v) => u({ autoReconnectOnDisconnect: v })}
        icon={<RefreshCw size={16} />}
        label="Auto-reconnect on unexpected disconnect"
        description="Recover established sessions after network loss or a server restart"
        settingKey="autoReconnectOnDisconnect"
        infoTooltip="Automatically creates a new transport and shell after an established session is unexpectedly lost. Authentication and host-key failures are not transient disconnects and must not be retried automatically."
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
            infoTooltip="Maximum number of reconnection attempts before giving up. The bounded default tolerates normal server reboot windows without retrying forever. Set to 0 only if you explicitly want unlimited attempts."
          />
          <div className="text-[10px] text-[var(--color-textMuted)] pl-1">
            {s.autoReconnectMaxAttempts === 0
              ? "Unlimited attempts"
              : `Up to ${s.autoReconnectMaxAttempts} attempts`}
          </div>
          <SelectRow
            label="Retry backoff"
            description="Increase the delay while the server remains unavailable"
            value={s.autoReconnectBackoff}
            options={[
              { value: "exponential", label: "Exponential" },
              { value: "fixed", label: "Fixed" },
            ]}
            onChange={(v) =>
              u({
                autoReconnectBackoff: v as "fixed" | "exponential",
              })
            }
            settingKey="autoReconnectBackoff"
            infoTooltip="Exponential backoff recovers quickly from brief drops, then slows down to avoid hammering a host that is rebooting or offline."
          />
          <SliderRow
            label="Initial retry delay"
            value={s.autoReconnectDelaySecs}
            min={1}
            max={60}
            unit="s"
            onChange={(v) => u({ autoReconnectDelaySecs: v })}
            settingKey="autoReconnectDelaySecs"
            infoTooltip="Number of seconds before the first reconnect attempt. Fixed backoff uses this for every attempt; exponential backoff grows from this value."
          />
          {s.autoReconnectBackoff === "exponential" && (
            <SliderRow
              label="Maximum retry delay"
              value={s.autoReconnectMaxDelaySecs}
              min={s.autoReconnectDelaySecs}
              max={300}
              unit="s"
              onChange={(v) => u({ autoReconnectMaxDelaySecs: v })}
              settingKey="autoReconnectMaxDelaySecs"
              infoTooltip="Caps exponential backoff so a recovered SSH daemon is discovered promptly while retries remain bounded."
            />
          )}
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
