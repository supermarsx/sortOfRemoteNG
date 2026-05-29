import React from "react";
import { CloudCog, RefreshCw } from "lucide-react";
import { useCloudSyncSettings } from "../../../hooks/settings/useCloudSyncSettings";
import SectionHeading from "../../ui/SectionHeading";
import AdvancedSection from "./cloudSync/AdvancedSection";
import AuthTokenModal from "./cloudSync/AuthTokenModal";
import ConflictResolutionSection from "./cloudSync/ConflictResolutionSection";
import EnableSyncToggle from "./cloudSync/EnableSyncToggle";
import EncryptionSection from "./cloudSync/EncryptionSection";
import NotificationsGrid from "./cloudSync/NotificationsGrid";
import SyncTargetsSection from "./cloudSync/SyncTargetsSection";
import StartupShutdownGrid from "./cloudSync/StartupShutdownGrid";
import SyncFrequencySelect from "./cloudSync/SyncFrequencySelect";
import SyncItemsGrid from "./cloudSync/SyncItemsGrid";
import SyncStatusOverview from "./cloudSync/SyncStatusOverview";
import type { CloudSyncSettingsProps } from "./cloudSync/types";

const CloudSyncSettings: React.FC<CloudSyncSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useCloudSyncSettings(settings, updateSettings);

  return (
    <div className="space-y-6 relative">
      <SectionHeading
        icon={<CloudCog className="w-5 h-5 text-primary" />}
        title="Cloud Sync"
        description="Synchronize connections and settings across devices using cloud storage providers."
      />
      <button
        onClick={() => mgr.handleSyncNow()}
        disabled={
          !mgr.cloudSync.enabled ||
          mgr.syncTargets.length === 0 ||
          mgr.isSyncing
        }
        className="absolute top-0 right-0 !mt-0 flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 disabled:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-colors text-sm"
      >
        <RefreshCw className="w-4 h-4" />
        Sync All
      </button>

      {/* Multi-Target Sync Status Overview */}
      {mgr.cloudSync.enabled && mgr.syncTargets.length > 0 && (
        <SyncStatusOverview mgr={mgr} />
      )}

      <EnableSyncToggle mgr={mgr} />
      <SyncTargetsSection mgr={mgr} />
      <SyncFrequencySelect mgr={mgr} />
      <SyncItemsGrid mgr={mgr} />
      <EncryptionSection mgr={mgr} />
      <ConflictResolutionSection mgr={mgr} />
      <StartupShutdownGrid mgr={mgr} />
      <NotificationsGrid mgr={mgr} />
      <AdvancedSection mgr={mgr} />

      {/* Auth Token Modal (scoped to a single target) */}
      {mgr.authTargetId && <AuthTokenModal mgr={mgr} />}
    </div>
  );
};

export default CloudSyncSettings;
