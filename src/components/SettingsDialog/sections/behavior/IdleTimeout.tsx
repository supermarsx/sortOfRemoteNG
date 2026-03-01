import React from "react";
import { Clock, Wifi, Timer, Eye } from "lucide-react";
import { Card, SectionHeader, SliderRow, Toggle } from "../../../ui/settings/SettingsPrimitives";
const IdleTimeout: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Timer className="w-4 h-4 text-orange-400" />}
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
        />
      )}
      <Toggle
        checked={s.dimInactiveTabs}
        onChange={(v) => u({ dimInactiveTabs: v })}
        icon={<Eye size={16} />}
        label="Dim inactive tabs"
        description="Reduce visual prominence of tabs that aren't focused"
        settingKey="dimInactiveTabs"
      />
      <Toggle
        checked={s.showIdleDuration}
        onChange={(v) => u({ showIdleDuration: v })}
        icon={<Clock size={16} />}
        label="Show idle duration on tabs"
        description="Display how long a session has been inactive as a badge"
        settingKey="showIdleDuration"
      />
    </Card>
  </div>
);

export default IdleTimeout;
