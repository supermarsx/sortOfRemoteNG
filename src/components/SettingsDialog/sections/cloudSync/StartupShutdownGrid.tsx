import { Power, LogIn, LogOut } from "lucide-react";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

function StartupShutdownGrid({ mgr }: { mgr: Mgr }) {
  return (
    <div className="space-y-4">
      <SectionHeader
        icon={<Power className="w-4 h-4 text-primary" />}
        title="Startup & Shutdown"
      />
      <Card>
        <Toggle
          icon={<LogIn size={16} />}
          label="Sync on Startup"
          description="Pull the latest data from the cloud when the app launches"
          checked={mgr.cloudSync.syncOnStartup}
          onChange={(v) => mgr.updateCloudSync({ syncOnStartup: v })}
          infoTooltip="Run a one-shot sync as soon as the app starts so the local data is fresh from the cloud."
        />

        <Toggle
          icon={<LogOut size={16} />}
          label="Sync on Shutdown"
          description="Push pending local changes when the app closes"
          checked={mgr.cloudSync.syncOnShutdown}
          onChange={(v) => mgr.updateCloudSync({ syncOnShutdown: v })}
          infoTooltip="Run a one-shot sync as the app is shutting down so pending local changes don't sit unsent."
        />
      </Card>
    </div>
  );
}

export default StartupShutdownGrid;
