import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings/settings";
import {
  LayoutGrid,
  Layers,
  Maximize2,
  Move,
  PanelLeft,
  ArrowLeftRight,
  FoldVertical,
  GripVertical,
  Network,
  Zap,
  FolderSync,
  FileStack,
  Settings,
  Shield,
  Keyboard,
  Activity,
  Code,
  ShieldCheck,
  Terminal,
  FileCode,
  Power,
  ScreenShare,
  ArrowUpDown,
  Bug,
  HardDrive,
  Cloud,
  RefreshCw,
  Cpu,
  ListVideo,
  Disc,
  FlaskConical,
} from "lucide-react";
import SectionHeading from "../../ui/SectionHeading";
import {
  Card,
  SettingsSectionHeader as SectionHeader,
  Toggle,
} from "../../ui/settings/SettingsPrimitives";
import { InfoTooltip } from "../../ui/InfoTooltip";

interface LayoutSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

/* ── Tab layout / grouping option configs ─────────────── */

const TAB_GROUPING_CONFIG = [
  {
    value: "none",
    labelKey: "settingsLayout.tabGrouping.none",
    labelDefault: "None",
    descriptionKey: "settingsLayout.tabGrouping.noneDescription",
    descriptionDefault: "No grouping",
  },
  {
    value: "protocol",
    labelKey: "settingsLayout.tabGrouping.protocol",
    labelDefault: "By Protocol",
    descriptionKey: "settingsLayout.tabGrouping.protocolDescription",
    descriptionDefault: "Group by SSH, RDP, etc.",
  },
  {
    value: "status",
    labelKey: "settingsLayout.tabGrouping.status",
    labelDefault: "By Status",
    descriptionKey: "settingsLayout.tabGrouping.statusDescription",
    descriptionDefault: "Group by connection state",
  },
  {
    value: "hostname",
    labelKey: "settingsLayout.tabGrouping.hostname",
    labelDefault: "By Hostname",
    descriptionKey: "settingsLayout.tabGrouping.hostnameDescription",
    descriptionDefault: "Group by server name",
  },
];

const DEFAULT_TAB_LAYOUT_CONFIG: Array<{
  value: GlobalSettings["defaultTabLayout"];
  labelKey: string;
  labelDefault: string;
  descriptionKey: string;
  descriptionDefault: string;
}> = [
  {
    value: "tabs",
    labelKey: "settingsLayout.defaultTabLayout.tabs",
    labelDefault: "Tabs",
    descriptionKey: "settingsLayout.defaultTabLayout.tabsDescription",
    descriptionDefault: "One session visible at a time",
  },
  {
    value: "splitVertical",
    labelKey: "settingsLayout.defaultTabLayout.splitVertical",
    labelDefault: "Split L/R",
    descriptionKey: "settingsLayout.defaultTabLayout.splitVerticalDescription",
    descriptionDefault: "2 columns, fills rows",
  },
  {
    value: "splitHorizontal",
    labelKey: "settingsLayout.defaultTabLayout.splitHorizontal",
    labelDefault: "Split T/B",
    descriptionKey:
      "settingsLayout.defaultTabLayout.splitHorizontalDescription",
    descriptionDefault: "2 rows, fills columns",
  },
  {
    value: "sideBySide",
    labelKey: "settingsLayout.defaultTabLayout.sideBySide",
    labelDefault: "Side-by-Side",
    descriptionKey: "settingsLayout.defaultTabLayout.sideBySideDescription",
    descriptionDefault: "2 cols, all sessions",
  },
  {
    value: "grid2",
    labelKey: "settingsLayout.defaultTabLayout.grid2",
    labelDefault: "Grid 2",
    descriptionKey: "settingsLayout.defaultTabLayout.grid2Description",
    descriptionDefault: "Capped at 2 tiles",
  },
  {
    value: "grid4",
    labelKey: "settingsLayout.defaultTabLayout.grid4",
    labelDefault: "Grid 4",
    descriptionKey: "settingsLayout.defaultTabLayout.grid4Description",
    descriptionDefault: "Capped at 4 tiles",
  },
  {
    value: "grid6",
    labelKey: "settingsLayout.defaultTabLayout.grid6",
    labelDefault: "Grid 6",
    descriptionKey: "settingsLayout.defaultTabLayout.grid6Description",
    descriptionDefault: "Capped at 6 tiles",
  },
  {
    value: "mosaic",
    labelKey: "settingsLayout.defaultTabLayout.mosaic",
    labelDefault: "Mosaic",
    descriptionKey: "settingsLayout.defaultTabLayout.mosaicDescription",
    descriptionDefault: "Auto sqrt grid",
  },
  {
    value: "miniMosaic",
    labelKey: "settingsLayout.defaultTabLayout.miniMosaic",
    labelDefault: "Mini Mosaic",
    descriptionKey: "settingsLayout.defaultTabLayout.miniMosaicDescription",
    descriptionDefault: "Preview tiles",
  },
  {
    value: "customGrid",
    labelKey: "settingsLayout.defaultTabLayout.customGrid",
    labelDefault: "Custom Grid",
    descriptionKey: "settingsLayout.defaultTabLayout.customGridDescription",
    descriptionDefault: "Pick rows x cols",
  },
];

export const LayoutSettings: React.FC<LayoutSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <SectionHeading
        icon={<LayoutGrid className="w-5 h-5 text-primary" />}
        title={t("settingsLayout.title", "Layout")}
        description={t(
          "settingsLayout.description",
          "Default tab layout and grouping, window persistence, sidebar behavior, tab reordering, and secondary bar icon visibility.",
        )}
      />

      {/* Window Persistence */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Maximize2 className="w-4 h-4 text-primary" />}
          title={t("settingsLayout.windowPersistence", "Window Persistence")}
        />
        <Card>
          <Toggle
            checked={settings.persistWindowSize}
            onChange={(v) => updateSettings({ persistWindowSize: v })}
            icon={<Maximize2 size={16} />}
            label={t(
              "settingsLayout.rememberWindowSize",
              "Remember window size",
            )}
            description={t(
              "settingsLayout.rememberWindowSizeDescription",
              "Save and restore the window dimensions between sessions",
            )}
            settingKey="persistWindowSize"
            infoTooltip={t(
              "settingsLayout.rememberWindowSizeTooltip",
              "Save and restore the window dimensions between sessions",
            )}
          />
          <Toggle
            checked={settings.persistWindowPosition}
            onChange={(v) => updateSettings({ persistWindowPosition: v })}
            icon={<Move size={16} />}
            label={t(
              "settingsLayout.rememberWindowPosition",
              "Remember window position",
            )}
            description={t(
              "settingsLayout.rememberWindowPositionDescription",
              "Save and restore where the window sits on screen",
            )}
            settingKey="persistWindowPosition"
            infoTooltip={t(
              "settingsLayout.rememberWindowPositionTooltip",
              "Save and restore the window location on screen between sessions",
            )}
          />
          <Toggle
            checked={settings.autoRepatriateWindow}
            onChange={(v) => updateSettings({ autoRepatriateWindow: v })}
            icon={<ScreenShare size={16} />}
            label={t(
              "settingsLayout.autoRepatriateWindow",
              "Auto-repatriate window if off-screen",
            )}
            description={t(
              "settingsLayout.autoRepatriateWindowDescription",
              "Bring the window back to a visible monitor when its saved position is off-screen (e.g. after disconnecting an external display)",
            )}
            settingKey="autoRepatriateWindow"
            infoTooltip={t(
              "settingsLayout.autoRepatriateWindowTooltip",
              "Move the window back to a visible monitor if its saved position is off-screen",
            )}
          />
        </Card>
      </div>

      {/* Sidebar Persistence */}
      <div className="space-y-4">
        <SectionHeader
          icon={<PanelLeft className="w-4 h-4 text-primary" />}
          title={t("settingsLayout.sidebarPersistence", "Sidebar Persistence")}
        />
        <Card>
          <Toggle
            checked={settings.persistSidebarWidth}
            onChange={(v) => updateSettings({ persistSidebarWidth: v })}
            icon={<ArrowLeftRight size={16} />}
            label={t(
              "settingsLayout.rememberSidebarWidth",
              "Remember sidebar width",
            )}
            description={t(
              "settingsLayout.rememberSidebarWidthDescription",
              "Restore the sidebar width after restarting",
            )}
            settingKey="persistSidebarWidth"
            infoTooltip={t(
              "settingsLayout.rememberSidebarWidthTooltip",
              "Persist the sidebar width so it stays the same after restarting",
            )}
          />
          <Toggle
            checked={settings.persistSidebarPosition}
            onChange={(v) => updateSettings({ persistSidebarPosition: v })}
            icon={<Move size={16} />}
            label={t(
              "settingsLayout.rememberSidebarPosition",
              "Remember sidebar position",
            )}
            description={t(
              "settingsLayout.rememberSidebarPositionDescription",
              "Save whether the sidebar is docked left or right",
            )}
            settingKey="persistSidebarPosition"
            infoTooltip={t(
              "settingsLayout.rememberSidebarPositionTooltip",
              "Save whether the sidebar is docked to the left or right side",
            )}
          />
          <Toggle
            checked={settings.persistSidebarCollapsed}
            onChange={(v) => updateSettings({ persistSidebarCollapsed: v })}
            icon={<FoldVertical size={16} />}
            label={t(
              "settingsLayout.rememberSidebarCollapsed",
              "Remember sidebar collapsed state",
            )}
            description={t(
              "settingsLayout.rememberSidebarCollapsedDescription",
              "Persist expanded or collapsed sidebar state between sessions",
            )}
            settingKey="persistSidebarCollapsed"
            infoTooltip={t(
              "settingsLayout.rememberSidebarCollapsedTooltip",
              "Persist whether the sidebar is expanded or collapsed between sessions",
            )}
          />
        </Card>
      </div>

      {/* Tab Interaction */}
      <div className="space-y-4">
        <SectionHeader
          icon={<GripVertical className="w-4 h-4 text-primary" />}
          title={t("settingsLayout.tabInteraction", "Tab Interaction")}
        />
        <Card>
          <Toggle
            checked={settings.enableTabReorder}
            onChange={(v) => updateSettings({ enableTabReorder: v })}
            icon={<FileStack size={16} />}
            label={t(
              "settingsLayout.allowTabReordering",
              "Allow tab reordering",
            )}
            description={t(
              "settingsLayout.allowTabReorderingDescription",
              "Drag-and-drop tabs in the tab bar",
            )}
            settingKey="enableTabReorder"
            infoTooltip={t(
              "settingsLayout.allowTabReorderingTooltip",
              "Enable drag-and-drop reordering of connection tabs in the tab bar",
            )}
          />
          <Toggle
            checked={settings.enableConnectionReorder}
            onChange={(v) => updateSettings({ enableConnectionReorder: v })}
            icon={<Network size={16} />}
            label={t(
              "settingsLayout.allowConnectionReordering",
              "Allow connection reordering",
            )}
            description={t(
              "settingsLayout.allowConnectionReorderingDescription",
              "Drag-and-drop connections inside the sidebar tree",
            )}
            settingKey="enableConnectionReorder"
            infoTooltip={t(
              "settingsLayout.allowConnectionReorderingTooltip",
              "Enable drag-and-drop reordering of connections in the sidebar tree",
            )}
          />
        </Card>
      </div>

      {/* Default Tab Layout */}
      <div className="space-y-4">
        <SectionHeader
          icon={<LayoutGrid className="w-4 h-4 text-primary" />}
          title={
            <span className="flex items-center gap-2">
              {t("settingsLayout.defaultTabLayoutTitle", "Default Tab Layout")}
              <InfoTooltip
                text={t(
                  "settingsLayout.defaultTabLayoutTooltip",
                  "Tiling mode used when the app starts. The active mode is also persisted across launches once you change it from the toolbar.",
                )}
              />
            </span>
          }
        />
        <Card>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {DEFAULT_TAB_LAYOUT_CONFIG.map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  updateSettings({ defaultTabLayout: option.value })
                }
                data-testid={`default-tab-layout-${option.value}`}
                className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                  settings.defaultTabLayout === option.value
                    ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
                    : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
                }`}
              >
                <LayoutGrid className="w-5 h-5 mb-1" />
                <span className="text-sm font-medium">
                  {t(option.labelKey, option.labelDefault)}
                </span>
                <span className="text-xs text-[var(--color-textSecondary)] mt-1 text-center">
                  {t(option.descriptionKey, option.descriptionDefault)}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Tab Grouping */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Layers className="w-4 h-4 text-primary" />}
          title={
            <span className="flex items-center gap-2">
              {t("settingsLayout.tabGroupingTitle", "Tab Grouping")}
              <InfoTooltip
                text={t(
                  "settingsLayout.tabGroupingTooltip",
                  "Organize open connection tabs into groups based on a shared property.",
                )}
              />
            </span>
          }
        />
        <Card>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {TAB_GROUPING_CONFIG.map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  updateSettings({ tabGrouping: option.value as any })
                }
                className={`flex flex-col items-center p-3 rounded-lg border transition-all ${
                  settings.tabGrouping === option.value
                    ? "border-primary bg-primary/20 text-[var(--color-text)] ring-1 ring-primary/50"
                    : "border-[var(--color-border)] bg-[var(--color-border)]/50 text-[var(--color-textSecondary)] hover:bg-[var(--color-border)] hover:border-[var(--color-textSecondary)]"
                }`}
              >
                <Layers className="w-5 h-5 mb-1" />
                <span className="text-sm font-medium">
                  {t(option.labelKey, option.labelDefault)}
                </span>
                <span className="text-xs text-[var(--color-textSecondary)] mt-1 text-center">
                  {t(option.descriptionKey, option.descriptionDefault)}
                </span>
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Secondary Bar Icons */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Settings className="w-4 h-4 text-primary" />}
          title={t("settingsLayout.secondaryBarIcons", "Secondary Bar Icons")}
        />
        <Card className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
          <Toggle
            checked={settings.showQuickConnectIcon}
            onChange={(v) => updateSettings({ showQuickConnectIcon: v })}
            icon={<Zap size={16} />}
            label={t("connections.quickConnect", "Quick Connect")}
            settingKey="showQuickConnectIcon"
            infoTooltip={t(
              "settingsLayout.showQuickConnectIconTooltip",
              "Show the Quick Connect icon for rapidly connecting to a host",
            )}
          />
          <Toggle
            checked={settings.showCollectionSwitcherIcon}
            onChange={(v) => updateSettings({ showCollectionSwitcherIcon: v })}
            icon={<FolderSync size={16} />}
            label={t(
              "settingsLayout.collectionSwitcher",
              "Collection Switcher",
            )}
            settingKey="showCollectionSwitcherIcon"
            infoTooltip={t(
              "settingsLayout.collectionSwitcherTooltip",
              "Show the icon for switching between connection collections",
            )}
          />
          <Toggle
            checked={settings.showImportExportIcon}
            onChange={(v) => updateSettings({ showImportExportIcon: v })}
            icon={<FileStack size={16} />}
            label={t("settingsLayout.importExport", "Import / Export")}
            settingKey="showImportExportIcon"
            infoTooltip={t(
              "settingsLayout.importExportTooltip",
              "Show the icon for importing and exporting connection data",
            )}
          />
          <Toggle
            checked={settings.showSettingsIcon}
            onChange={(v) => updateSettings({ showSettingsIcon: v })}
            icon={<Settings size={16} />}
            label={t("settings.title", "Settings")}
            settingKey="showSettingsIcon"
            infoTooltip={t(
              "settingsLayout.settingsIconTooltip",
              "Show the settings icon in the secondary bar",
            )}
          />
          <Toggle
            checked={settings.showProxyMenuIcon}
            onChange={(v) => updateSettings({ showProxyMenuIcon: v })}
            icon={<Shield size={16} />}
            label={t("settingsLayout.proxyVpnMenu", "Proxy / VPN Menu")}
            settingKey="showProxyMenuIcon"
            infoTooltip={t(
              "settingsLayout.proxyVpnMenuTooltip",
              "Show the proxy and VPN management icon",
            )}
          />
          <Toggle
            checked={settings.showInternalProxyIcon}
            onChange={(v) => updateSettings({ showInternalProxyIcon: v })}
            icon={<ArrowUpDown size={16} />}
            label={t(
              "settingsLayout.internalProxyManager",
              "Internal Proxy Manager",
            )}
            settingKey="showInternalProxyIcon"
            infoTooltip={t(
              "settingsLayout.internalProxyManagerTooltip",
              "Show the internal authentication proxy manager icon",
            )}
          />
          <Toggle
            checked={settings.showShortcutManagerIcon}
            onChange={(v) => updateSettings({ showShortcutManagerIcon: v })}
            icon={<Keyboard size={16} />}
            label={t("settingsLayout.shortcutManager", "Shortcut Manager")}
            settingKey="showShortcutManagerIcon"
            infoTooltip={t(
              "settingsLayout.shortcutManagerTooltip",
              "Show the keyboard shortcut manager icon",
            )}
          />
          <Toggle
            checked={settings.showPerformanceMonitorIcon}
            onChange={(v) => updateSettings({ showPerformanceMonitorIcon: v })}
            icon={<Activity size={16} />}
            label={t(
              "settingsLayout.performanceMonitor",
              "Performance Monitor",
            )}
            settingKey="showPerformanceMonitorIcon"
            infoTooltip={t(
              "settingsLayout.performanceMonitorTooltip",
              "Show the real-time performance monitor icon",
            )}
          />
          <Toggle
            checked={settings.showActionLogIcon}
            onChange={(v) => updateSettings({ showActionLogIcon: v })}
            icon={<FileStack size={16} />}
            label={t("settingsLayout.actionLog", "Action Log")}
            settingKey="showActionLogIcon"
            infoTooltip={t(
              "settingsLayout.actionLogTooltip",
              "Show the action log icon for reviewing recent application actions and events",
            )}
          />
          <Toggle
            checked={settings.showDevtoolsIcon}
            onChange={(v) => updateSettings({ showDevtoolsIcon: v })}
            icon={<Code size={16} />}
            label={t("settingsLayout.devtools", "Devtools")}
            settingKey="showDevtoolsIcon"
            infoTooltip={t(
              "settingsLayout.devtoolsTooltip",
              "Show the developer tools icon for inspecting the application UI",
            )}
          />
          <Toggle
            checked={settings.showDebugPanelIcon}
            onChange={(v) => updateSettings({ showDebugPanelIcon: v })}
            icon={<FlaskConical size={16} />}
            label={t("settingsLayout.debugPanel", "Debug Panel")}
            settingKey="showDebugPanelIcon"
            infoTooltip={t(
              "settingsLayout.debugPanelTooltip",
              "Show the debug panel icon for development and troubleshooting tools",
            )}
          />
          <Toggle
            checked={settings.showSecurityIcon}
            onChange={(v) => updateSettings({ showSecurityIcon: v })}
            icon={<ShieldCheck size={16} />}
            label={t("settings.security", "Security")}
            settingKey="showSecurityIcon"
            infoTooltip={t(
              "settingsLayout.securityIconTooltip",
              "Show the security icon for quick access to security-related tools",
            )}
          />
          <Toggle
            checked={settings.showWolIcon}
            onChange={(v) => updateSettings({ showWolIcon: v })}
            icon={<Power size={16} />}
            label={t("settingsLayout.wakeOnLan", "Wake-on-LAN")}
            settingKey="showWolIcon"
            infoTooltip={t(
              "settingsLayout.wakeOnLanTooltip",
              "Show the Wake-on-LAN icon for sending wake packets to remote machines",
            )}
          />
          <Toggle
            checked={settings.showBulkSSHIcon}
            onChange={(v) => updateSettings({ showBulkSSHIcon: v })}
            icon={<Terminal size={16} />}
            label={t("settingsLayout.bulkSshCommander", "Bulk SSH Commander")}
            settingKey="showBulkSSHIcon"
            infoTooltip={t(
              "settingsLayout.bulkSshCommanderTooltip",
              "Show the Bulk SSH Commander icon for running SSH commands across multiple hosts",
            )}
          />
          <Toggle
            checked={settings.showScriptManagerIcon}
            onChange={(v) => updateSettings({ showScriptManagerIcon: v })}
            icon={<FileCode size={16} />}
            label={t("settingsLayout.scriptManager", "Script Manager")}
            settingKey="showScriptManagerIcon"
            infoTooltip={t(
              "settingsLayout.scriptManagerTooltip",
              "Show the Script Manager icon for managing reusable scripts",
            )}
          />
          <Toggle
            checked={settings.showMacroManagerIcon}
            onChange={(v) => updateSettings({ showMacroManagerIcon: v })}
            icon={<ListVideo size={16} />}
            label={t("settingsLayout.macroManager", "Macro Manager")}
            settingKey="showMacroManagerIcon"
            infoTooltip={t(
              "settingsLayout.macroManagerTooltip",
              "Show the Macro Manager icon for recording and replaying command sequences",
            )}
          />
          <Toggle
            checked={settings.showRecordingManagerIcon}
            onChange={(v) => updateSettings({ showRecordingManagerIcon: v })}
            icon={<Disc size={16} />}
            label={t("settingsLayout.recordingManager", "Recording Manager")}
            settingKey="showRecordingManagerIcon"
            infoTooltip={t(
              "settingsLayout.recordingManagerTooltip",
              "Show the Recording Manager icon for managing recorded sessions",
            )}
          />
          <Toggle
            checked={settings.showErrorLogBar}
            onChange={(v) => updateSettings({ showErrorLogBar: v })}
            icon={<Bug size={16} />}
            label={t("settingsLayout.errorLogBar", "Error Log Bar")}
            settingKey="showErrorLogBar"
            infoTooltip={t(
              "settingsLayout.errorLogBarTooltip",
              "Show the error log bar toggle for quickly opening recent application errors",
            )}
          />
          <Toggle
            checked={settings.showBackupStatusIcon}
            onChange={(v) => updateSettings({ showBackupStatusIcon: v })}
            icon={<HardDrive size={16} />}
            label={t("settingsLayout.backupStatus", "Backup Status")}
            settingKey="showBackupStatusIcon"
            infoTooltip={t(
              "settingsLayout.backupStatusTooltip",
              "Show the backup status icon for monitoring local backup state",
            )}
          />
          <Toggle
            checked={settings.showCloudSyncStatusIcon}
            onChange={(v) => updateSettings({ showCloudSyncStatusIcon: v })}
            icon={<Cloud size={16} />}
            label={t("settingsLayout.cloudSyncStatus", "Cloud Sync Status")}
            settingKey="showCloudSyncStatusIcon"
            infoTooltip={t(
              "settingsLayout.cloudSyncStatusTooltip",
              "Show the cloud sync status icon for monitoring remote synchronization state",
            )}
          />
          <Toggle
            checked={settings.showSyncBackupStatusIcon}
            onChange={(v) => updateSettings({ showSyncBackupStatusIcon: v })}
            icon={<RefreshCw size={16} />}
            label={t(
              "settingsLayout.syncBackupCombined",
              "Sync & Backup (Combined)",
            )}
            settingKey="showSyncBackupStatusIcon"
            infoTooltip={t(
              "settingsLayout.syncBackupCombinedTooltip",
              "Show a combined status icon for backup and cloud sync activity",
            )}
          />
          <Toggle
            checked={settings.showRdpSessionsIcon}
            onChange={(v) => updateSettings({ showRdpSessionsIcon: v })}
            icon={<Cpu size={16} />}
            label={t("settingsLayout.rdpSessions", "RDP Sessions")}
            settingKey="showRdpSessionsIcon"
            infoTooltip={t(
              "settingsLayout.rdpSessionsTooltip",
              "Show the RDP Sessions icon for opening and monitoring RDP session tools",
            )}
          />
        </Card>
      </div>
    </div>
  );
};

export default LayoutSettings;
