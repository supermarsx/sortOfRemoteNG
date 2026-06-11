import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlobalSettings } from "../../src/types/settings/settings";
import BehaviorSettings from "../../src/components/SettingsDialog/sections/BehaviorSettings";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

const behaviorSettings = {
  singleClickConnect: false,
  singleClickDisconnect: false,
  doubleClickConnect: true,
  doubleClickRename: false,
  middleClickCloseTab: true,
  folderSingleClickToggle: true,
  folderDoubleClickToggle: true,
  openConnectionInBackground: false,
  openWinmgmtToolInBackground: false,
  switchTabOnActivity: false,
  closeTabOnDisconnect: false,
  confirmCloseActiveTab: true,
  enableRecentlyClosedTabs: true,
  recentlyClosedTabsMax: 10,
  focusTerminalOnTabSwitch: true,
  scrollTreeToActiveConnection: true,
  restoreLastActiveTab: true,
  tabCycleMru: false,
  singleWindowMode: false,
  singleConnectionMode: false,
  reconnectOnReload: true,
  enableAutocomplete: true,
  enableWinrmTools: true,
  copyOnSelect: true,
  pasteOnRightClick: true,
  trimPastedWhitespace: true,
  warnOnMultiLinePaste: true,
  clearClipboardAfterSeconds: 30,
  maxPasteLengthChars: 10000,
  idleDisconnectMinutes: 0,
  sendKeepaliveOnIdle: true,
  keepaliveIntervalSeconds: 30,
  dimInactiveTabs: false,
  showIdleDuration: true,
  autoReconnectOnDisconnect: true,
  autoReconnectMaxAttempts: 3,
  autoReconnectDelaySecs: 5,
  notifyOnReconnect: true,
  notifyOnConnect: true,
  notifyOnDisconnect: true,
  notifyOnError: true,
  notificationSound: false,
  flashTaskbarOnActivity: true,
  confirmDisconnect: true,
  confirmDeleteConnection: true,
  confirmDeleteTabGroup: true,
  confirmBulkOperations: true,
  confirmImport: true,
  confirmDeleteAllBookmarks: true,
  enableFileDragDropToTerminal: true,
  enableFileDragDropToRdp: true,
  showDropPreview: true,
  dragSensitivityPx: 5,
  terminalScrollSpeed: 1,
  terminalSmoothScroll: true,
  treeRightClickAction: "contextMenu",
  mouseBackAction: "previousTab",
  mouseForwardAction: "nextTab",
} as unknown as GlobalSettings;

describe("Behavior settings section accents", () => {
  it("uses the accent color for the page and subsection icons", () => {
    const { container } = render(
      <BehaviorSettings settings={behaviorSettings} updateSettings={vi.fn()} />,
    );

    expect(container.querySelector("h3 svg")?.getAttribute("class")).toContain(
      "text-primary",
    );

    const sectionIcons = Array.from(
      container.querySelectorAll(".sor-settings-section-header > svg"),
    );

    expect(sectionIcons).toHaveLength(11);
    for (const icon of sectionIcons) {
      expect(icon.getAttribute("class")).toContain("text-primary");
    }
  });

  it("updates the folder double-click toggle", () => {
    const updateSettings = vi.fn();

    render(
      <BehaviorSettings
        settings={behaviorSettings}
        updateSettings={updateSettings}
      />,
    );

    fireEvent.click(screen.getByLabelText(/folder expand on double click/i));

    expect(updateSettings).toHaveBeenCalledWith({
      folderDoubleClickToggle: false,
    });
  });
});
