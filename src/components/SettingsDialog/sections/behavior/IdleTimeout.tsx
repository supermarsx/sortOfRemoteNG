import type { SectionProps } from "./types";
import React from "react";
import { Clock, Wifi, Timer, Eye } from "lucide-react";
import { Card, SectionHeader, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const IdleTimeout: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Timer className="w-4 h-4 text-warning" />}
      title="Idle & Timeout"
    />
    <Card>
      <SliderRow
        label="Idle disconnect"
        value={s.idleDisconnectMinutes}
        min={0}
        max={480}
        step={5}
        unit="m"
        onChange={(v) => u({ idleDisconnectMinutes: v })}
        settingKey="idleDisconnectMinutes"
        infoTooltip="Automatically disconnect a session after this many minutes of inactivity. Set to 0 to disable idle disconnection."
      />
      <div className="text-[10px] text-[var(--color-textMuted)] pl-1">
        {s.idleDisconnectMinutes === 0
          ? "Disabled — sessions never disconnect due to idle"
          : `Disconnect after ${s.idleDisconnectMinutes} minutes of inactivity`}
      </div>
      <Toggle
        checked={s.sendKeepaliveOnIdle}
        onChange={(v) => u({ sendKeepaliveOnIdle: v })}
        icon={<Wifi size={16} />}
        label="Send keepalive packets on idle"
        description="Prevent server-side timeout by sending periodic keepalive signals"
        settingKey="sendKeepaliveOnIdle"
        infoTooltip="Send periodic keepalive packets to the remote server while the session is idle to prevent the server from dropping the connection due to inactivity."
      />
      {s.sendKeepaliveOnIdle && (
        <SliderRow
          label="Keepalive interval"
          value={s.keepaliveIntervalSeconds}
          min={5}
          max={300}
          step={5}
          unit="s"
          onChange={(v) => u({ keepaliveIntervalSeconds: v })}
          settingKey="keepaliveIntervalSeconds"
          infoTooltip="How often keepalive packets are sent to the server, in seconds. Lower values are more reliable but generate more network traffic."
        />
      )}
      <Toggle
        checked={s.dimInactiveTabs}
        onChange={(v) => u({ dimInactiveTabs: v })}
        icon={<Eye size={16} />}
        label="Dim inactive tabs"
        description="Reduce visual prominence of tabs that aren't focused"
        settingKey="dimInactiveTabs"
        infoTooltip="Visually dim tabs that are not currently focused, making it easier to identify which tab is active at a glance."
      />
      <Toggle
        checked={s.showIdleDuration}
        onChange={(v) => u({ showIdleDuration: v })}
        icon={<Clock size={16} />}
        label="Show idle duration on tabs"
        description="Display how long a session has been inactive as a badge"
        settingKey="showIdleDuration"
        infoTooltip="Display a time badge on each tab showing how long the session has been idle. Helps identify stale connections that may need attention."
      />
    </Card>
  </div>
);

export default IdleTimeout;
