import type { Mgr } from "./types";
import React from "react";
import { Archive } from "lucide-react";
import {
  Card,
  Toggle,
} from "../../../ui/settings/SettingsPrimitives";

const EnableBackup: React.FC<{ mgr: Mgr }> = ({ mgr }) => (
  <Card>
    <Toggle
      checked={mgr.backup.enabled}
      onChange={(v: boolean) => mgr.updateBackup({ enabled: v })}
      icon={<Archive size={16} />}
      label="Enable automatic backups"
      description="Automatically back up your connections and settings on a schedule"
      infoTooltip="When enabled, your connections and settings are automatically backed up on the configured schedule."
    />
  </Card>
);

export default EnableBackup;
