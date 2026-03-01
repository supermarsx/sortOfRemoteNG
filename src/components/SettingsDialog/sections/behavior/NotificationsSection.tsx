import React from "react";
import { Bell, Volume2, MonitorUp } from "lucide-react";
import { Card, SectionHeader, Toggle } from "../../../ui/settings/SettingsPrimitives";
const NotificationsSection: React.FC<SectionProps> = ({ s, u }) => (
  <div className="space-y-4">
    <SectionHeader
      icon={<Bell className="w-4 h-4 text-pink-400" />}
      title="Notifications"
    />
    <Card>
      <Toggle
        checked={s.notifyOnConnect}
        onChange={(v) => u({ notifyOnConnect: v })}
        icon={<Bell size={16} />}
        label="Notify on connect"
        description="Show an OS notification when a session is established"
        settingKey="notifyOnConnect"
      />
      <Toggle
        checked={s.notifyOnDisconnect}
        onChange={(v) => u({ notifyOnDisconnect: v })}
        icon={<Bell size={16} />}
        label="Notify on disconnect"
        description="Show an OS notification when a session ends"
        settingKey="notifyOnDisconnect"
      />
      <Toggle
        checked={s.notifyOnError}
        onChange={(v) => u({ notifyOnError: v })}
        icon={<Bell size={16} />}
        label="Notify on error"
        description="Show an OS notification when a connection fails"
        settingKey="notifyOnError"
      />
      <Toggle
        checked={s.notificationSound}
        onChange={(v) => u({ notificationSound: v })}
        icon={<Volume2 size={16} />}
        label="Play sound with notifications"
        settingKey="notificationSound"
      />
      <Toggle
        checked={s.flashTaskbarOnActivity}
        onChange={(v) => u({ flashTaskbarOnActivity: v })}
        icon={<MonitorUp size={16} />}
        label="Flash taskbar on background activity"
        description="Flash the app's taskbar icon when a background tab has activity"
        settingKey="flashTaskbarOnActivity"
      />
    </Card>
  </div>
);

export default NotificationsSection;
