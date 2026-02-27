import React from "react";
import { useTranslation } from "react-i18next";
import { GlobalSettings } from "../../../types/settings";
import {
  MousePointerClick,
  MousePointer2,
  AppWindow,
  Link,
  RefreshCw,
  TextCursorInput,
  Layers,
  Focus,
  Clipboard,
  Clock,
  Wifi,
  Bell,
  ShieldAlert,
  GripVertical,
  ScrollText,
  Hand,
  Timer,
  Volume2,
  Zap,
  ArrowLeftRight,
  Eye,
  Trash2,
  FileDown,
  FileUp,
  MonitorUp,
  Compass,
  ArrowUpDown,
  PanelRight,
  Gauge,
  Keyboard,
  Network,
  Server,
  Radio,
  TerminalSquare,
  FileCode,
  ListVideo,
  Circle,
  Globe,
} from "lucide-react";
import type { ToolDisplayMode, ToolDisplayModeOverride, ToolDisplayModes } from "../../../types/settings";
import {
  SettingsCard as Card,
  SettingsSectionHeader as SectionHeader,
  SettingsSelectRow as SelectRow,
  SettingsSliderRow as SliderRow,
  SettingsToggleRow as Toggle,
} from "../../ui/SettingsPrimitives";

interface BehaviorSettingsProps {
  settings: GlobalSettings;
  updateSettings: (updates: Partial<GlobalSettings>) => void;
}

/* ================================================================ */

const BehaviorSettings: React.FC<BehaviorSettingsProps> = ({
  settings,
  updateSettings,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-medium text-[var(--color-text)] flex items-center gap-2">
        <MousePointerClick className="w-5 h-5" />
        Behavior
      </h3>
      <p className="text-xs text-[var(--color-textSecondary)] mb-4">
        Click actions, tab behavior, clipboard, notifications, and reconnection settings.
      </p>

      {/* ── 1. Click Actions ─────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<MousePointer2 className="w-4 h-4 text-blue-400" />}
          title="Click Actions"
        />
        <p className="text-xs text-gray-500">
          Control what mouse clicks do in the connection tree, tabs, and elsewhere.
        </p>
        <Card>
          <Toggle
            checked={settings.singleClickConnect}
            onChange={(v) => updateSettings({ singleClickConnect: v })}
            icon={<MousePointer2 size={16} />}
            label="Connect on single click"
            description="Immediately connect when clicking a connection in the tree"
            settingKey="singleClickConnect"
          />
          <Toggle
            checked={settings.singleClickDisconnect}
            onChange={(v) => updateSettings({ singleClickDisconnect: v })}
            icon={<MousePointer2 size={16} />}
            label="Disconnect on single click (active connections)"
            description="Click an active connection to disconnect it"
            settingKey="singleClickDisconnect"
          />
          <Toggle
            checked={settings.doubleClickConnect}
            onChange={(v) => updateSettings({ doubleClickConnect: v })}
            icon={<MousePointer2 size={16} />}
            label="Connect on double click"
            description="Double-click a connection to open/connect it"
            settingKey="doubleClickConnect"
          />
          <Toggle
            checked={settings.doubleClickRename}
            onChange={(v) => updateSettings({ doubleClickRename: v })}
            icon={<MousePointer2 size={16} />}
            label="Rename on double click"
            description="Double-click a connection name to rename it inline"
            settingKey="doubleClickRename"
          />
          <Toggle
            checked={settings.middleClickCloseTab}
            onChange={(v) => updateSettings({ middleClickCloseTab: v })}
            icon={<MousePointer2 size={16} />}
            label="Middle-click to close tab"
            description="Middle mouse button closes the clicked tab"
            settingKey="middleClickCloseTab"
          />
        </Card>
      </div>

      {/* ── 2. Tab Behavior ──────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Layers className="w-4 h-4 text-cyan-400" />}
          title="Tab Behavior"
        />
        <Card>
          <Toggle
            checked={settings.openConnectionInBackground}
            onChange={(v) => updateSettings({ openConnectionInBackground: v })}
            icon={<Layers size={16} />}
            label="Open new connections in background"
            description="New tabs open without switching to them"
            settingKey="openConnectionInBackground"
          />
          <Toggle
            checked={settings.switchTabOnActivity}
            onChange={(v) => updateSettings({ switchTabOnActivity: v })}
            icon={<Zap size={16} />}
            label="Switch to tab on activity"
            description="Automatically focus a tab when it receives new output"
            settingKey="switchTabOnActivity"
          />
          <Toggle
            checked={settings.closeTabOnDisconnect}
            onChange={(v) => updateSettings({ closeTabOnDisconnect: v })}
            icon={<Layers size={16} />}
            label="Close tab on disconnect"
            description="Automatically close the tab when the session ends"
            settingKey="closeTabOnDisconnect"
          />
          <Toggle
            checked={settings.confirmCloseActiveTab}
            onChange={(v) => updateSettings({ confirmCloseActiveTab: v })}
            icon={<ShieldAlert size={16} />}
            label="Confirm before closing active tab"
            description="Show a warning before closing a tab with a live session"
            settingKey="confirmCloseActiveTab"
          />
          <Toggle
            checked={settings.enableRecentlyClosedTabs}
            onChange={(v) => updateSettings({ enableRecentlyClosedTabs: v })}
            icon={<Clock size={16} />}
            label="Enable recently-closed tabs list"
            description="Keep a list of recently closed tabs so you can reopen them"
            settingKey="enableRecentlyClosedTabs"
          />
          {settings.enableRecentlyClosedTabs && (
            <SliderRow
              label="Max recently closed"
              value={settings.recentlyClosedTabsMax}
              min={1}
              max={50}
              onChange={(v) => updateSettings({ recentlyClosedTabsMax: v })}
              settingKey="recentlyClosedTabsMax"
            />
          )}
        </Card>
      </div>

      {/* ── 3. Focus & Navigation ────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Focus className="w-4 h-4 text-emerald-400" />}
          title="Focus & Navigation"
        />
        <Card>
          <Toggle
            checked={settings.focusTerminalOnTabSwitch}
            onChange={(v) => updateSettings({ focusTerminalOnTabSwitch: v })}
            icon={<Focus size={16} />}
            label="Focus terminal when switching tabs"
            description="Automatically place keyboard focus in the terminal or canvas"
            settingKey="focusTerminalOnTabSwitch"
          />
          <Toggle
            checked={settings.scrollTreeToActiveConnection}
            onChange={(v) => updateSettings({ scrollTreeToActiveConnection: v })}
            icon={<Compass size={16} />}
            label="Scroll sidebar to active connection"
            description="Auto-scroll the connection tree to highlight the active session"
            settingKey="scrollTreeToActiveConnection"
          />
          <Toggle
            checked={settings.restoreLastActiveTab}
            onChange={(v) => updateSettings({ restoreLastActiveTab: v })}
            icon={<Clock size={16} />}
            label="Restore last active tab on startup"
            description="Re-select the tab that was focused when the app was closed"
            settingKey="restoreLastActiveTab"
          />
          <Toggle
            checked={settings.tabCycleMru}
            onChange={(v) => updateSettings({ tabCycleMru: v })}
            icon={<ArrowLeftRight size={16} />}
            label="Cycle tabs in most-recently-used order"
            description="Ctrl+Tab cycles by recency instead of left-to-right position"
            settingKey="tabCycleMru"
          />
        </Card>
      </div>

      {/* ── 4. Window & Connection ───────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<AppWindow className="w-4 h-4 text-purple-400" />}
          title="Window & Connection"
        />
        <Card>
          <Toggle
            checked={settings.singleWindowMode}
            onChange={(v) => updateSettings({ singleWindowMode: v })}
            icon={<AppWindow size={16} />}
            label="Disallow multiple instances"
            settingKey="singleWindowMode"
          />
          <Toggle
            checked={settings.singleConnectionMode}
            onChange={(v) => updateSettings({ singleConnectionMode: v })}
            icon={<Link size={16} />}
            label={t("connections.singleConnection")}
            description="Only one connection can be active at a time"
            settingKey="singleConnectionMode"
          />
          <Toggle
            checked={settings.reconnectOnReload}
            onChange={(v) => updateSettings({ reconnectOnReload: v })}
            icon={<RefreshCw size={16} />}
            label={t("connections.reconnectOnReload")}
            description="Re-establish active sessions when the window reloads"
            settingKey="reconnectOnReload"
          />
          <Toggle
            checked={settings.enableAutocomplete}
            onChange={(v) => updateSettings({ enableAutocomplete: v })}
            icon={<TextCursorInput size={16} />}
            label="Enable browser autocomplete on input fields"
            description="Allow the browser to suggest previously entered values"
            settingKey="enableAutocomplete"
          />
        </Card>
      </div>

      {/* ── 5. Clipboard ─────────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Clipboard className="w-4 h-4 text-amber-400" />}
          title="Clipboard"
        />
        <Card>
          <Toggle
            checked={settings.copyOnSelect}
            onChange={(v) => updateSettings({ copyOnSelect: v })}
            icon={<Clipboard size={16} />}
            label="Copy on select"
            description="Selecting text in the terminal copies it to clipboard automatically"
            settingKey="copyOnSelect"
          />
          <Toggle
            checked={settings.pasteOnRightClick}
            onChange={(v) => updateSettings({ pasteOnRightClick: v })}
            icon={<Clipboard size={16} />}
            label="Paste on right-click"
            description="Right-click inside the terminal pastes from clipboard"
            settingKey="pasteOnRightClick"
          />
          <Toggle
            checked={settings.trimPastedWhitespace}
            onChange={(v) => updateSettings({ trimPastedWhitespace: v })}
            icon={<Clipboard size={16} />}
            label="Trim whitespace from pasted text"
            description="Strip leading and trailing whitespace when pasting"
            settingKey="trimPastedWhitespace"
          />
          <Toggle
            checked={settings.warnOnMultiLinePaste}
            onChange={(v) => updateSettings({ warnOnMultiLinePaste: v })}
            icon={<ShieldAlert size={16} />}
            label="Warn before pasting multi-line text"
            description="Show a confirmation when pasting text that contains newlines"
            settingKey="warnOnMultiLinePaste"
          />
          <SliderRow
            label="Clear clipboard after paste"
            value={settings.clearClipboardAfterSeconds}
            min={0}
            max={120}
            step={5}
            unit="s"
            onChange={(v) => updateSettings({ clearClipboardAfterSeconds: v })}
            settingKey="clearClipboardAfterSeconds"
          />
          <div className="text-[10px] text-gray-500 pl-1">
            {settings.clearClipboardAfterSeconds === 0
              ? 'Disabled — clipboard is never cleared automatically'
              : `Clipboard will be cleared ${settings.clearClipboardAfterSeconds}s after pasting a password`}
          </div>
          <SliderRow
            label="Max paste length"
            value={settings.maxPasteLengthChars}
            min={0}
            max={100000}
            step={1000}
            unit=""
            onChange={(v) => updateSettings({ maxPasteLengthChars: v })}
            settingKey="maxPasteLengthChars"
          />
          <div className="text-[10px] text-gray-500 pl-1">
            {settings.maxPasteLengthChars === 0
              ? 'No limit — paste any amount of text'
              : `Prompt before pasting more than ${settings.maxPasteLengthChars.toLocaleString()} characters`}
          </div>
        </Card>
      </div>

      {/* ── 6. Idle & Timeout ────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Timer className="w-4 h-4 text-orange-400" />}
          title="Idle & Timeout"
        />
        <Card>
          <SliderRow
            label="Idle disconnect"
            value={settings.idleDisconnectMinutes}
            min={0}
            max={480}
            step={5}
            unit="m"
            onChange={(v) => updateSettings({ idleDisconnectMinutes: v })}
            settingKey="idleDisconnectMinutes"
          />
          <div className="text-[10px] text-gray-500 pl-1">
            {settings.idleDisconnectMinutes === 0
              ? 'Disabled — sessions never disconnect due to idle'
              : `Disconnect after ${settings.idleDisconnectMinutes} minutes of inactivity`}
          </div>
          <Toggle
            checked={settings.sendKeepaliveOnIdle}
            onChange={(v) => updateSettings({ sendKeepaliveOnIdle: v })}
            icon={<Wifi size={16} />}
            label="Send keepalive packets on idle"
            description="Prevent server-side timeout by sending periodic keepalive signals"
            settingKey="sendKeepaliveOnIdle"
          />
          {settings.sendKeepaliveOnIdle && (
            <SliderRow
              label="Keepalive interval"
              value={settings.keepaliveIntervalSeconds}
              min={5}
              max={300}
              step={5}
              unit="s"
              onChange={(v) => updateSettings({ keepaliveIntervalSeconds: v })}
              settingKey="keepaliveIntervalSeconds"
            />
          )}
          <Toggle
            checked={settings.dimInactiveTabs}
            onChange={(v) => updateSettings({ dimInactiveTabs: v })}
            icon={<Eye size={16} />}
            label="Dim inactive tabs"
            description="Reduce visual prominence of tabs that aren't focused"
            settingKey="dimInactiveTabs"
          />
          <Toggle
            checked={settings.showIdleDuration}
            onChange={(v) => updateSettings({ showIdleDuration: v })}
            icon={<Clock size={16} />}
            label="Show idle duration on tabs"
            description="Display how long a session has been inactive as a badge"
            settingKey="showIdleDuration"
          />
        </Card>
      </div>

      {/* ── 7. Reconnection ──────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Wifi className="w-4 h-4 text-sky-400" />}
          title="Reconnection"
        />
        <Card>
          <Toggle
            checked={settings.autoReconnectOnDisconnect}
            onChange={(v) => updateSettings({ autoReconnectOnDisconnect: v })}
            icon={<RefreshCw size={16} />}
            label="Auto-reconnect on unexpected disconnect"
            description="Attempt to re-establish the connection if it drops"
            settingKey="autoReconnectOnDisconnect"
          />
          {settings.autoReconnectOnDisconnect && (
            <>
              <SliderRow
                label="Max attempts"
                value={settings.autoReconnectMaxAttempts}
                min={0}
                max={50}
                onChange={(v) => updateSettings({ autoReconnectMaxAttempts: v })}
                settingKey="autoReconnectMaxAttempts"
              />
              <div className="text-[10px] text-gray-500 pl-1">
                {settings.autoReconnectMaxAttempts === 0 ? 'Unlimited attempts' : `Up to ${settings.autoReconnectMaxAttempts} attempts`}
              </div>
              <SliderRow
                label="Delay between attempts"
                value={settings.autoReconnectDelaySecs}
                min={1}
                max={60}
                unit="s"
                onChange={(v) => updateSettings({ autoReconnectDelaySecs: v })}
                settingKey="autoReconnectDelaySecs"
              />
            </>
          )}
          <Toggle
            checked={settings.notifyOnReconnect}
            onChange={(v) => updateSettings({ notifyOnReconnect: v })}
            icon={<Bell size={16} />}
            label="Notify on successful reconnect"
            description="Show a notification when a dropped session is restored"
            settingKey="notifyOnReconnect"
          />
        </Card>
      </div>

      {/* ── 8. Notifications ─────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<Bell className="w-4 h-4 text-pink-400" />}
          title="Notifications"
        />
        <Card>
          <Toggle
            checked={settings.notifyOnConnect}
            onChange={(v) => updateSettings({ notifyOnConnect: v })}
            icon={<Bell size={16} />}
            label="Notify on connect"
            description="Show an OS notification when a session is established"
            settingKey="notifyOnConnect"
          />
          <Toggle
            checked={settings.notifyOnDisconnect}
            onChange={(v) => updateSettings({ notifyOnDisconnect: v })}
            icon={<Bell size={16} />}
            label="Notify on disconnect"
            description="Show an OS notification when a session ends"
            settingKey="notifyOnDisconnect"
          />
          <Toggle
            checked={settings.notifyOnError}
            onChange={(v) => updateSettings({ notifyOnError: v })}
            icon={<Bell size={16} />}
            label="Notify on error"
            description="Show an OS notification when a connection fails"
            settingKey="notifyOnError"
          />
          <Toggle
            checked={settings.notificationSound}
            onChange={(v) => updateSettings({ notificationSound: v })}
            icon={<Volume2 size={16} />}
            label="Play sound with notifications"
            settingKey="notificationSound"
          />
          <Toggle
            checked={settings.flashTaskbarOnActivity}
            onChange={(v) => updateSettings({ flashTaskbarOnActivity: v })}
            icon={<MonitorUp size={16} />}
            label="Flash taskbar on background activity"
            description="Flash the app's taskbar icon when a background tab has activity"
            settingKey="flashTaskbarOnActivity"
          />
        </Card>
      </div>

      {/* ── 9. Confirmation Dialogs ──────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<ShieldAlert className="w-4 h-4 text-red-400" />}
          title="Confirmation Dialogs"
        />
        <p className="text-xs text-gray-500">
          Control which destructive or significant actions require confirmation.
        </p>
        <Card>
          <Toggle
            checked={settings.confirmDisconnect}
            onChange={(v) => updateSettings({ confirmDisconnect: v })}
            icon={<ShieldAlert size={16} />}
            label="Confirm before disconnecting"
            description="Ask before closing an active session"
            settingKey="confirmDisconnect"
          />
          <Toggle
            checked={settings.confirmDeleteConnection}
            onChange={(v) => updateSettings({ confirmDeleteConnection: v })}
            icon={<Trash2 size={16} />}
            label="Confirm before deleting connections"
            description="Prompt before permanently removing a saved connection"
            settingKey="confirmDeleteConnection"
          />
          <Toggle
            checked={settings.confirmBulkOperations}
            onChange={(v) => updateSettings({ confirmBulkOperations: v })}
            icon={<ShieldAlert size={16} />}
            label="Confirm bulk operations"
            description="Ask before multi-select actions like batch connect or delete"
            settingKey="confirmBulkOperations"
          />
          <Toggle
            checked={settings.confirmImport}
            onChange={(v) => updateSettings({ confirmImport: v })}
            icon={<FileDown size={16} />}
            label="Confirm before importing"
            description="Show a summary before importing connections or settings"
            settingKey="confirmImport"
          />
          <Toggle
            checked={settings.confirmDeleteAllBookmarks}
            onChange={(v) => updateSettings({ confirmDeleteAllBookmarks: v })}
            icon={<Trash2 size={16} />}
            label="Confirm before deleting all bookmarks"
            settingKey="confirmDeleteAllBookmarks"
          />
        </Card>
      </div>

      {/* ── 10. Drag & Drop ──────────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<GripVertical className="w-4 h-4 text-indigo-400" />}
          title="Drag & Drop"
        />
        <Card>
          <Toggle
            checked={settings.enableFileDragDropToTerminal}
            onChange={(v) => updateSettings({ enableFileDragDropToTerminal: v })}
            icon={<FileUp size={16} />}
            label="Enable file drag-and-drop to terminal"
            description="Drop files onto an SSH session to upload via SCP/SFTP"
            settingKey="enableFileDragDropToTerminal"
          />
          <Toggle
            checked={settings.showDropPreview}
            onChange={(v) => updateSettings({ showDropPreview: v })}
            icon={<Eye size={16} />}
            label="Show drop preview overlay"
            description="Display a visual indicator when dragging items over valid targets"
            settingKey="showDropPreview"
          />
          <SliderRow
            label="Drag sensitivity"
            value={settings.dragSensitivityPx}
            min={1}
            max={20}
            unit="px"
            onChange={(v) => updateSettings({ dragSensitivityPx: v })}
            settingKey="dragSensitivityPx"
          />
        </Card>
      </div>

      {/* ── 11. Scroll & Input ───────────────────────────── */}
      <div className="space-y-4">
        <SectionHeader
          icon={<ScrollText className="w-4 h-4 text-teal-400" />}
          title="Scroll & Input"
        />
        <Card>
          <SliderRow
            label="Terminal scroll speed"
            value={settings.terminalScrollSpeed}
            min={0.25}
            max={5}
            step={0.25}
            unit="x"
            onChange={(v) => updateSettings({ terminalScrollSpeed: v })}
            settingKey="terminalScrollSpeed"
          />
          <Toggle
            checked={settings.terminalSmoothScroll}
            onChange={(v) => updateSettings({ terminalSmoothScroll: v })}
            icon={<ArrowUpDown size={16} />}
            label="Smooth scrolling in terminal"
            description="Enable smooth scroll animation instead of jumping"
            settingKey="terminalSmoothScroll"
          />
          <SelectRow
            label="Right-click in tree"
            value={settings.treeRightClickAction}
            options={[
              { value: 'contextMenu', label: 'Context menu' },
              { value: 'quickConnect', label: 'Quick connect' },
            ]}
            onChange={(v) => updateSettings({ treeRightClickAction: v as 'contextMenu' | 'quickConnect' })}
            settingKey="treeRightClickAction"
          />
          <SelectRow
            label="Mouse back button"
            value={settings.mouseBackAction}
            options={[
              { value: 'none', label: 'Do nothing' },
              { value: 'previousTab', label: 'Previous tab' },
              { value: 'disconnect', label: 'Disconnect' },
            ]}
            onChange={(v) => updateSettings({ mouseBackAction: v as 'none' | 'previousTab' | 'disconnect' })}
            settingKey="mouseBackAction"
          />
          <SelectRow
            label="Mouse forward button"
            value={settings.mouseForwardAction}
            options={[
              { value: 'none', label: 'Do nothing' },
              { value: 'nextTab', label: 'Next tab' },
              { value: 'reconnect', label: 'Reconnect' },
            ]}
            onChange={(v) => updateSettings({ mouseForwardAction: v as 'none' | 'nextTab' | 'reconnect' })}
            settingKey="mouseForwardAction"
          />
        </Card>
      </div>

      {/* Tool Display Modes */}
      <div className="space-y-4">
        <SectionHeader
          icon={<PanelRight className="w-4 h-4" />}
          title="Tool Display Modes"
        />
        <p className="text-[10px] text-gray-500 -mt-2">
          Set a global default, then override per tool. "Inherit" uses the global default.
        </p>
        <Card>
          {/* Global default */}
          <div className="flex items-center justify-between gap-4 pb-3 mb-3 border-b border-[var(--color-border)]" data-setting-key="toolDisplayModes.globalDefault">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span className="text-sm font-medium text-[var(--color-text)]">Global Default</span>
            </div>
            <select
              value={settings.toolDisplayModes?.globalDefault ?? 'popup'}
              onChange={(e) => updateSettings({
                toolDisplayModes: {
                  ...defaultToolDisplayModes,
                  ...settings.toolDisplayModes,
                  globalDefault: e.target.value as ToolDisplayMode,
                },
              })}
              className="px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)]"
            >
              <option value="popup">Popup</option>
              <option value="tab">Tab</option>
            </select>
          </div>

          {/* Per-tool overrides */}
          {(TOOL_ENTRIES).map(tool => {
            const current = settings.toolDisplayModes?.[tool.key] ?? 'inherit';
            const resolved = current === 'inherit'
              ? (settings.toolDisplayModes?.globalDefault ?? 'popup')
              : current;
            const Icon = tool.icon;
            return (
              <div
                key={tool.key}
                className="flex items-center justify-between gap-4"
                data-setting-key={`toolDisplayModes.${tool.key}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="w-3.5 h-3.5 text-[var(--color-textSecondary)] flex-shrink-0" />
                  <span className="text-sm text-[var(--color-textSecondary)] truncate">{tool.label}</span>
                  {current === 'inherit' && (
                    <span className="text-[10px] text-gray-500 flex-shrink-0">({resolved})</span>
                  )}
                </div>
                <select
                  value={current}
                  onChange={(e) => updateSettings({
                    toolDisplayModes: {
                      ...defaultToolDisplayModes,
                      ...settings.toolDisplayModes,
                      [tool.key]: e.target.value as ToolDisplayModeOverride,
                    },
                  })}
                  className="px-2 py-1 bg-[var(--color-border)] border border-[var(--color-border)] rounded text-sm text-[var(--color-text)]"
                >
                  <option value="inherit">Inherit</option>
                  <option value="popup">Popup</option>
                  <option value="tab">Tab</option>
                </select>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
};

type ToolEntryKey = Exclude<keyof ToolDisplayModes, 'globalDefault'>;

const TOOL_ENTRIES: { key: ToolEntryKey; label: string; icon: LucideIcon }[] = [
  { key: 'recordingManager', label: 'Recording Manager', icon: Circle },
  { key: 'macroManager', label: 'Macro Manager', icon: ListVideo },
  { key: 'scriptManager', label: 'Script Manager', icon: FileCode },
  { key: 'performanceMonitor', label: 'Performance Monitor', icon: Gauge },
  { key: 'actionLog', label: 'Action Log', icon: ScrollText },
  { key: 'shortcutManager', label: 'Shortcut Manager', icon: Keyboard },
  { key: 'bulkSsh', label: 'Bulk SSH Commander', icon: TerminalSquare },
  { key: 'internalProxy', label: 'Internal Proxy Manager', icon: Server },
  { key: 'proxyChain', label: 'Proxy Chain Menu', icon: Network },
  { key: 'wol', label: 'Wake-on-LAN', icon: Radio },
];

const defaultToolDisplayModes: ToolDisplayModes = {
  globalDefault: 'popup',
  recordingManager: 'inherit',
  macroManager: 'inherit',
  scriptManager: 'inherit',
  performanceMonitor: 'inherit',
  actionLog: 'inherit',
  shortcutManager: 'inherit',
  bulkSsh: 'inherit',
  internalProxy: 'inherit',
  proxyChain: 'inherit',
  wol: 'inherit',
};

export default BehaviorSettings;
