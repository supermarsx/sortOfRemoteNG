import React from "react";
import SectionHeading from '../../ui/SectionHeading';
import { Archive, Play } from "lucide-react";
import SectionHeading from '../../ui/SectionHeading';
import { useBackupSettings } from "../../../hooks/settings/useBackupSettings";
import SectionHeading from '../../ui/SectionHeading';
import locationPresetIcons from "./backup/locationPresetIcons";
import SectionHeading from '../../ui/SectionHeading';
import EnableBackup from "./backup/EnableBackup";
import SectionHeading from '../../ui/SectionHeading';
import DestinationSection from "./backup/DestinationSection";
import SectionHeading from '../../ui/SectionHeading';
import ScheduleSection from "./backup/ScheduleSection";
import SectionHeading from '../../ui/SectionHeading';
import DifferentialSection from "./backup/DifferentialSection";
import SectionHeading from '../../ui/SectionHeading';
import FormatContentSection from "./backup/FormatContentSection";
import SectionHeading from '../../ui/SectionHeading';
import EncryptionSection from "./backup/EncryptionSection";
import SectionHeading from '../../ui/SectionHeading';
import AdvancedSection from "./backup/AdvancedSection";
import SectionHeading from '../../ui/SectionHeading';
import LastBackupInfo from "./backup/LastBackupInfo";
import SectionHeading from '../../ui/SectionHeading';

const BackupSettings: React.FC<BackupSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useBackupSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <SectionHeading icon={<Archive className="w-5 h-5" />} title="Backup" />
        <button
          onClick={mgr.handleRunBackupNow}
          disabled={!mgr.backup.destinationPath || mgr.isRunningBackup}
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-colors text-sm"
        >
          <Play className="w-4 h-4" />
          Backup Now
        </button>
      </div>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Automatic and manual backup scheduling, encryption, destination, and
        retention settings.
      </p>

      <EnableBackup mgr={mgr} />
      <DestinationSection mgr={mgr} />
      <ScheduleSection mgr={mgr} />
      <DifferentialSection mgr={mgr} />
      <FormatContentSection mgr={mgr} />
      <EncryptionSection mgr={mgr} />
      <AdvancedSection mgr={mgr} />
      <LastBackupInfo mgr={mgr} />
    </div>
  );
};

export default BackupSettings;
