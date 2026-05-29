import { Cloud } from "lucide-react";
import {
  Card,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";
import type { Mgr } from "./types";

function EnableSyncToggle({ mgr }: { mgr: Mgr }) {
  return (
    <Card>
      <Toggle
        checked={mgr.cloudSync.enabled}
        onChange={(v: boolean) => mgr.updateCloudSync({ enabled: v })}
        icon={<Cloud size={16} />}
        label="Enable cloud sync"
        description="Synchronize your connections and settings across devices"
        infoTooltip="When enabled, the configured cloud-sync targets are kept in sync on the configured frequency."
      />
    </Card>
  );
}

export default EnableSyncToggle;
