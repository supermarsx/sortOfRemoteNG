import React from "react";
import {
  X,
  Save,
  RotateCcw,
  Loader2,
  Gauge,
  Settings as SettingsIcon,
  Search,
} from "lucide-react";
import GeneralSettings from "./sections/GeneralSettings";
import ThemeSettings from "./sections/ThemeSettings";
import LayoutSettings from "./sections/LayoutSettings";
import SecuritySettings from "./sections/SecuritySettings";
import PerformanceSettings from "./sections/PerformanceSettings";
import ProxySettings from "./sections/ProxySettings";
import AdvancedSettings from "./sections/AdvancedSettings";
import StartupSettings from "./sections/StartupSettings";
import ApiSettings from "./sections/ApiSettings";
import RecoverySettings from "./sections/RecoverySettings";
import BehaviorSettings from "./sections/BehaviorSettings";
import SSHTerminalSettings from "./sections/SSHTerminalSettings";
import BackupSettings from "./sections/BackupSettings";
import CloudSyncSettings from "./sections/CloudSyncSettings";
import { TrustVerificationSettings } from "./sections/TrustVerificationSettings";
import WebBrowserSettings from "./sections/WebBrowserSettings";
import RdpDefaultSettings from "./sections/RdpDefaultSettings";
import BackendSettings from "./sections/BackendSettings";
import RecordingSettings from "./sections/RecordingSettings";
import MacroSettings from "./sections/MacroSettings";
import { ConfirmDialog } from "../ConfirmDialog";
import { Modal } from "../ui/Modal";
import { SETTINGS_TABS, TAB_DEFAULTS } from "./settingsConstants";
import {
  useSettingsDialog,
  type SettingsDialogMgr,
} from "../../hooks/useSettingsDialog";

/* ═══════════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════════ */

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/* ═══════════════════════════════════════════════════════════════
   Sidebar
   ═══════════════════════════════════════════════════════════════ */

const Sidebar: React.FC<{ mgr: SettingsDialogMgr }> = ({ mgr }) => {
  const filteredTabs = mgr.searchQuery
    ? SETTINGS_TABS.filter((t) => mgr.searchResult.matchedSections.has(t.id))
    : SETTINGS_TABS;

  return (
    <div className="w-64 bg-[var(--color-background)] border-r border-[var(--color-border)] flex flex-col">
      {/* Search */}
      <div className="p-3 border-b border-[var(--color-border)]/50">
        <div className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--color-surface)] border border-[var(--color-border)]/50 rounded-lg">
          <Search
            size={14}
            className="text-[var(--color-textSecondary)] flex-shrink-0"
          />
          <input
            type="text"
            value={mgr.searchQuery}
            onChange={(e) => {
              mgr.setSearchQuery(e.target.value);
              mgr.setHighlightKey(null);
            }}
            placeholder="Search settings..."
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder-gray-500 outline-none"
          />
          {mgr.searchQuery && (
            <button
              onClick={() => {
                mgr.setSearchQuery("");
                mgr.setHighlightKey(null);
              }}
              className="text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredTabs.map((tab) => {
          const Icon = tab.icon;
          const label = mgr.t(tab.labelKey, tab.fallback ?? tab.labelKey);
          const sectionResults = mgr.searchResult.resultsBySection.get(tab.id);
          return (
            <div key={tab.id}>
              <button
                onClick={() => {
                  mgr.setActiveTab(tab.id);
                  mgr.setHighlightKey(null);
                }}
                className={`w-full flex items-center space-x-3 px-3 py-2 rounded-md text-left transition-colors ${
                  mgr.activeTab === tab.id
                    ? "bg-blue-600 text-[var(--color-text)]"
                    : "text-[var(--color-textSecondary)] hover:bg-[var(--color-surface)]"
                }`}
              >
                <Icon size={16} />
                <span className="text-sm">{label}</span>
                {mgr.searchQuery && sectionResults && (
                  <span className="ml-auto text-[10px] bg-blue-500/30 text-blue-300 px-1.5 py-0.5 rounded-full">
                    {sectionResults.length}
                  </span>
                )}
              </button>
              {mgr.searchQuery &&
                sectionResults &&
                mgr.activeTab === tab.id && (
                  <div className="ml-7 mt-0.5 mb-1 space-y-0.5">
                    {sectionResults.map((entry) => (
                      <button
                        key={entry.key}
                        onClick={() => {
                          mgr.setActiveTab(tab.id);
                          mgr.setHighlightKey(entry.key);
                        }}
                        className="w-full text-left px-2 py-1 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)]/50 rounded truncate"
                      >
                        {entry.label}
                      </button>
                    ))}
                  </div>
                )}
            </div>
          );
        })}
        {mgr.searchQuery && mgr.searchResult.matchedSections.size === 0 && (
          <div className="p-4 text-center text-xs text-gray-500">
            No settings match &quot;{mgr.searchQuery}&quot;
          </div>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   ContentPanel — tab-switched settings panels
   ═══════════════════════════════════════════════════════════════ */

const ContentPanel: React.FC<{ mgr: SettingsDialogMgr }> = ({ mgr }) => {
  if (!mgr.settings) return null;
  const s = mgr.settings;
  const u = mgr.updateSettings;

  return (
    <div
      ref={mgr.contentScrollRef}
      className="flex-1 overflow-y-auto min-h-0 flex flex-col"
    >
      <div className="flex-1 p-6">
        {mgr.activeTab === "general" && (
          <GeneralSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "behavior" && (
          <BehaviorSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "startup" && (
          <StartupSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "theme" && (
          <ThemeSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "layout" && (
          <LayoutSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "security" && (
          <SecuritySettings
            settings={s}
            updateSettings={u}
            handleBenchmark={mgr.handleBenchmark}
            isBenchmarking={mgr.isBenchmarking}
          />
        )}
        {mgr.activeTab === "trust" && (
          <TrustVerificationSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "performance" && (
          <PerformanceSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "rdpDefaults" && (
          <RdpDefaultSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "backup" && (
          <BackupSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "cloudSync" && (
          <CloudSyncSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "proxy" && (
          <ProxySettings settings={s} updateProxy={mgr.updateProxy} />
        )}
        {mgr.activeTab === "sshTerminal" && (
          <SSHTerminalSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "recording" && (
          <RecordingSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "macros" && (
          <MacroSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "webBrowser" && (
          <WebBrowserSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "backend" && (
          <BackendSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "api" && (
          <ApiSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "advanced" && (
          <AdvancedSettings settings={s} updateSettings={u} />
        )}
        {mgr.activeTab === "recovery" && <RecoverySettings onClose={() => {}} />}

        {/* Sentinel for scroll-to-bottom detection */}
        <div ref={mgr.bottomSentinelRef} className="h-px" />
      </div>

      {/* Per-tab reset footer */}
      {mgr.hasScrolledToBottom &&
        mgr.activeTab !== "recovery" &&
        TAB_DEFAULTS[mgr.activeTab] && (
          <div className="sticky bottom-0 flex justify-end px-6 py-2 border-t border-[var(--color-border)]/30 bg-[var(--color-surface)]/80 backdrop-blur-sm">
            <button
              onClick={mgr.handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[var(--color-textSecondary)] hover:text-[var(--color-text)] bg-[var(--color-surfaceHover)] hover:bg-[var(--color-border)] rounded-lg transition-colors"
            >
              <RotateCcw size={12} />
              {mgr.t("settings.reset", "Reset to Defaults")}
            </button>
          </div>
        )}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   BenchmarkOverlay
   ═══════════════════════════════════════════════════════════════ */

const BenchmarkOverlay: React.FC<{ mgr: SettingsDialogMgr }> = ({ mgr }) => {
  if (!mgr.isBenchmarking) return null;
  return (
    <Modal
      isOpen={mgr.isBenchmarking}
      closeOnBackdrop={false}
      closeOnEscape={false}
      backdropClassName="z-[60] bg-black/70 p-4"
      panelClassName="max-w-sm mx-4"
    >
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center">
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-full border-4 border-[var(--color-border)] border-t-blue-500 animate-spin" />
            <Gauge className="w-8 h-8 text-blue-400 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-2">
            {mgr.t("security.benchmarking", "Running Benchmark")}
          </h3>
          <p className="text-sm text-[var(--color-textSecondary)] mb-4">
            Testing encryption performance to find optimal iteration count...
          </p>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>
              This may take{" "}
              {mgr.settings?.benchmarkTimeSeconds || 1} second(s)
            </span>
          </div>
        </div>
      </div>
    </Modal>
  );
};

/* ═══════════════════════════════════════════════════════════════
   Root Component
   ═══════════════════════════════════════════════════════════════ */

export const SettingsDialog: React.FC<SettingsDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const mgr = useSettingsDialog(isOpen, onClose);

  if (!isOpen || !mgr.settings) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      panelClassName="max-w-4xl mx-4 h-[90vh]"
      contentClassName="overflow-hidden"
      dataTestId="settings-dialog-modal"
    >
      <div
        className={`bg-[var(--color-surface)] rounded-xl shadow-xl w-full h-[90vh] overflow-hidden flex flex-col border border-[var(--color-border)] ${mgr.contextSettings.backgroundGlowEnabled ? "settings-glow" : ""} relative`}
      >
        {/* Header bar */}
        <div className="sticky top-0 z-10 border-b border-[var(--color-border)] px-5 py-4 flex items-center justify-between bg-[var(--color-surface)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-500/20 rounded-lg">
              <SettingsIcon size={18} className="text-blue-500" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {mgr.t("settings.title")}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {mgr.dialogConfig.showSaveButton && (
              <button
                onClick={mgr.handleSave}
                data-tooltip={mgr.t("settings.save")}
                aria-label={mgr.t("settings.save")}
                className="p-2 bg-blue-600 hover:bg-blue-700 text-[var(--color-text)] rounded-lg transition-colors"
              >
                <Save size={16} />
              </button>
            )}
            <button
              onClick={onClose}
              data-tooltip={mgr.t("settings.cancel")}
              aria-label={mgr.t("settings.cancel")}
              className="p-2 hover:bg-[var(--color-surfaceHover)] rounded-lg transition-colors text-[var(--color-textSecondary)] hover:text-[var(--color-text)]"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          <Sidebar mgr={mgr} />
          <ContentPanel mgr={mgr} />
        </div>
      </div>

      <ConfirmDialog
        isOpen={mgr.showResetConfirm}
        message={mgr.t(
          "settings.resetTabConfirm",
          `Reset "${SETTINGS_TABS.find((t) => t.id === mgr.activeTab)?.labelKey}" settings to defaults?`,
        )}
        onConfirm={mgr.confirmReset}
        onCancel={() => mgr.setShowResetConfirm(false)}
      />

      <BenchmarkOverlay mgr={mgr} />
    </Modal>
  );
};
