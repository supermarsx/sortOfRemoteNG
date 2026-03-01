import React from "react";
import { PasswordInput } from "../../ui/forms/PasswordInput";
import {
  Cloud,
  CloudCog,
  CloudOff,
  RefreshCw,
  Settings,
  Shield,
  Clock,
  FolderSync,
  Lock,
  Bell,
  ChevronDown,
  ChevronUp,
  Info,
  Check,
  X,
  AlertTriangle,
  Globe,
  Upload,
  Download,
  Zap,
  FileKey,
  Database,
  Folder,
  HardDrive,
  Key,
  Palette,
  Keyboard,
} from "lucide-react";
import {
  CloudSyncProviders,
  CloudSyncProvider,
  CloudSyncFrequencies,
  CloudSyncFrequency,
  ConflictResolutionStrategies,
  ConflictResolutionStrategy,
  GlobalSettings,
} from "../../../types/settings";
import { Modal } from "../../ui/overlays/Modal";
import {
  useCloudSyncSettings,
  providerLabels,
  providerDescriptions,
  providerIcons,
  frequencyLabels,
  conflictLabels,
  conflictDescriptions,
} from "../../../hooks/settings/useCloudSyncSettings";
import { Checkbox, NumberInput, Select } from '../../ui/forms';
import AdvancedSection from "./cloudSync/AdvancedSection";
import SectionHeading from '../../ui/SectionHeading';
import AuthTokenModal from "./cloudSync/AuthTokenModal";
import SectionHeading from '../../ui/SectionHeading';
import ConflictResolutionSection from "./cloudSync/ConflictResolutionSection";
import SectionHeading from '../../ui/SectionHeading';
import EnableSyncToggle from "./cloudSync/EnableSyncToggle";
import SectionHeading from '../../ui/SectionHeading';
import EncryptionSection from "./cloudSync/EncryptionSection";
import SectionHeading from '../../ui/SectionHeading';
import NotificationsGrid from "./cloudSync/NotificationsGrid";
import SectionHeading from '../../ui/SectionHeading';
import ProviderList from "./cloudSync/ProviderList";
import SectionHeading from '../../ui/SectionHeading';
import StartupShutdownGrid from "./cloudSync/StartupShutdownGrid";
import SectionHeading from '../../ui/SectionHeading';
import SyncFrequencySelect from "./cloudSync/SyncFrequencySelect";
import SectionHeading from '../../ui/SectionHeading';
import SyncItemsGrid from "./cloudSync/SyncItemsGrid";
import SectionHeading from '../../ui/SectionHeading';
import SyncStatusOverview from "./cloudSync/SyncStatusOverview";
import SectionHeading from '../../ui/SectionHeading';
import type { CloudSyncSettingsProps, Mgr } from "./cloudSync/types";
import SectionHeading from '../../ui/SectionHeading';

interface CloudSyncSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

type Mgr = ReturnType<typeof useCloudSyncSettings>;

const CloudSyncSettings: React.FC<CloudSyncSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const mgr = useCloudSyncSettings(settings, updateSettings);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <SectionHeading icon={<CloudCog className="w-5 h-5" />} title="Cloud Sync" />
        <button
          onClick={() => mgr.handleSyncNow()}
          disabled={
            !mgr.cloudSync.enabled ||
            mgr.enabledProviders.length === 0 ||
            mgr.isSyncing
          }
          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-[var(--color-surfaceHover)] disabled:cursor-not-allowed text-[var(--color-text)] rounded-lg transition-colors text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Sync All
        </button>
      </div>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Synchronize connections and settings across devices using cloud storage
        providers.
      </p>

      {/* Multi-Target Sync Status Overview */}
      {mgr.cloudSync.enabled && mgr.enabledProviders.length > 0 && (
        <SyncStatusOverview mgr={mgr} />
      )}

      {/* Enable Cloud Sync */}
      <EnableSyncToggle mgr={mgr} />

      {/* Multi-Target Cloud Providers */}
      <ProviderList mgr={mgr} />

      {/* Sync Frequency */}
      <SyncFrequencySelect mgr={mgr} />

      {/* What to Sync */}
      <SyncItemsGrid mgr={mgr} />

      {/* Encryption */}
      <EncryptionSection mgr={mgr} />

      {/* Conflict Resolution */}
      <ConflictResolutionSection mgr={mgr} />

      {/* Startup/Shutdown Options */}
      <StartupShutdownGrid mgr={mgr} />

      {/* Notifications */}
      <NotificationsGrid mgr={mgr} />

      {/* Advanced Options */}
      <AdvancedSection mgr={mgr} />

      {/* Auth Token Modal */}
      {mgr.authProvider && <AuthTokenModal mgr={mgr} />}
    </div>
  );
};

export default CloudSyncSettings;
