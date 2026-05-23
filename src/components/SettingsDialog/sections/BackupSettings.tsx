import React from "react";
import SectionHeading from '../../ui/SectionHeading';
import { Archive, Play } from "lucide-react";
import { useBackupSettings } from "../../../hooks/settings/useBackupSettings";
import type { GlobalSettings } from "../../../types/settings/settings";

interface BackupSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}
import locationPresetIcons from "./backup/locationPresetIcons";
import EnableBackup from "./backup/EnableBackup";
import DestinationSection from "./backup/DestinationSection";
import ScheduleSection from "./backup/ScheduleSection";
import DeltaSkipSection from "./backup/DeltaSkipSection";
import DifferentialSection from "./backup/DifferentialSection";
import FormatContentSection from "./backup/FormatContentSection";
import EncryptionSection from "./backup/EncryptionSection";
import AdvancedSection from "./backup/AdvancedSection";
import LastBackupInfo from "./backup/LastBackupInfo";

const BackupSettings: React.FC<BackupSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useBackupSettings(settings, updateSettings);

  // "Backup Now" is enabled when *any* destination is configured —
  // either a non-empty legacy `destinationPath` or at least one
  // enabled multi-target row.
  const hasAnyDestination =
    Boolean(mgr.backup.destinationPath) ||
    mgr.destinations.some((d) => d.enabled);

  return (
    <div className="space-y-6 relative">
      <SectionHeading
        icon={<Archive className="w-5 h-5 text-primary" />}
        title="Backup"
        description="Automatic and manual backup scheduling, encryption, destination, and retention settings."
      />
      <button
        onClick={mgr.handleRunBackupNow}
        disabled={!hasAnyDestination || mgr.isRunningBackup}
        className="absolute top-0 right-0 !mt-0 flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-colors text-sm"
      >
        <Play className="w-4 h-4" />
        Backup Now
      </button>

      <EnableBackup mgr={mgr} />
      <DestinationSection mgr={mgr} />
      <ScheduleSection mgr={mgr} />
      <DeltaSkipSection mgr={mgr} />
      <DifferentialSection mgr={mgr} />
      <FormatContentSection mgr={mgr} />
      <EncryptionSection mgr={mgr} />
      <AdvancedSection mgr={mgr} />
      <LastBackupInfo mgr={mgr} />
    </div>
  );
};

export default BackupSettings;
