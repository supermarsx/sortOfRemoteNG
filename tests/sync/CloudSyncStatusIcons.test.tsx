import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { CloudSyncStatusPopup } from "../../src/components/sync/CloudSyncStatusPopup";
import { SyncBackupStatusBar } from "../../src/components/sync/SyncBackupStatusBar";
import { CloudSyncStatusIcon } from "../../src/components/sync/CloudSyncStatusIcon";
import { SETTINGS_TABS } from "../../src/components/SettingsDialog/settingsConstants";
import { CloudSync } from "lucide-react";

const { manager } = vi.hoisted(() => ({ manager: vi.fn() }));
vi.mock("../../src/components/ui/overlays/ToolbarPopover", () => ({
  ToolbarPopover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolbarPopoverHeader: () => null,
}));
vi.mock("../../src/hooks/sync/useCloudSyncStatus", () => ({
  useCloudSyncStatus: manager,
  PROVIDER_NAMES: { nextcloud: "Nextcloud", webdav: "WebDAV" },
  formatRelativeTime: () => "Never",
}));
vi.mock("../../src/hooks/sync/useSyncBackupStatusBar", () => ({
  useSyncBackupStatusBar: manager,
  PROVIDER_NAMES: { nextcloud: "Nextcloud", webdav: "WebDAV" },
  formatRelativeTime: () => "Never",
  formatNextTime: () => "Not scheduled",
  formatBytes: () => "0 B",
}));

const makeManager = () => ({
  t: (_key: string, fallback: string) => fallback,
  isOpen: true,
  isExpanded: true,
  setIsOpen: vi.fn(),
  setIsExpanded: vi.fn(),
  dropdownRef: React.createRef<HTMLDivElement>(),
  hasSync: true,
  isSyncing: false,
  isProviderSyncing: (_provider: string) => false,
  isTesting: false,
  testingProvider: null,
  isBackingUp: false,
  backupStatus: {
    backupCount: 1,
    lastBackupStatus: "failed",
    totalSizeBytes: 0,
  },
  enabledProviders: ["nextcloud", "webdav"],
  config: {
    frequency: "manual",
    providerStatus: {
      nextcloud: {
        lastSyncStatus: "failed",
        lastSyncError: "Server unavailable",
      },
      webdav: { lastSyncStatus: "failed" },
    },
  },
  handleSyncAll: vi.fn(),
  handleSyncProvider: vi.fn(),
  handleTestAll: vi.fn(),
  handleTestProvider: vi.fn(),
  handleBackupNow: vi.fn(),
  getLastSyncTime: () => undefined,
  getTestResultForProvider: () => undefined,
});

describe.each([
  ["popup", CloudSyncStatusPopup, "cloud-sync-status"],
  ["combined bar", SyncBackupStatusBar, "sync-status-bar"],
] as const)("Cloud sync icons: %s", (_name, Component, triggerId) => {
  beforeEach(() => manager.mockReturnValue(makeManager()));

  it.each([
    [undefined, "cloud-sync", "text-[var(--color-textSecondary)]"],
    ["success", "cloud-check", "text-success"],
    ["partial", "cloud-alert", "text-warning"],
    ["conflict", "cloud-alert", "text-warning"],
  ])(
    "keeps a cloud silhouette for %s status",
    (lastSyncStatus, icon, color) => {
      const mgr = makeManager();
      manager.mockReturnValue({
        ...mgr,
        config: {
          ...mgr.config,
          providerStatus: {
            nextcloud: { lastSyncStatus },
            webdav: { lastSyncStatus },
          },
        },
      });
      render(<Component />);
      expect(
        screen.getByTestId(triggerId).querySelector(`.lucide-${icon}`),
      ).toHaveClass(color);
      expect(
        screen.getByRole("button", { name: /Sync All/ }).querySelector("svg"),
      ).toHaveClass("lucide-cloud-sync");
    },
  );

  it("uses a labeled cloud with an x for overall and provider failures", () => {
    render(<Component />);
    expect(
      document.querySelector('svg[data-cloud-sync-provider="nextcloud"]'),
    ).toBeInTheDocument();
    expect(
      document.querySelector('svg[data-cloud-sync-provider="webdav"]'),
    ).toBeInTheDocument();
    const overall = within(screen.getByTestId(triggerId)).getByRole("img", {
      name: "Sync failed",
    });
    expect(overall.querySelector(".lucide-cloud")).toBeInTheDocument();
    expect(overall.querySelector(".lucide-x")).toBeInTheDocument();
    expect(overall.querySelector(".text-error")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Nextcloud: Sync failed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "WebDAV: Sync failed" }),
    ).toBeInTheDocument();
  });

  it("shows Sync All activity for every participating provider, then restores status", () => {
    manager.mockReturnValue({
      ...makeManager(),
      isSyncing: true,
      isProviderSyncing: () => true,
    });
    const { rerender } = render(<Component />);
    expect(
      screen.getByRole("img", { name: "Nextcloud: Syncing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "WebDAV: Syncing" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /Sync failed/ }),
    ).not.toBeInTheDocument();
    const syncAll = screen.getByRole("button", { name: /Sync All/ });
    expect(syncAll).toBeDisabled();
    expect(syncAll.querySelector(".lucide-cloud-sync")).toBeInTheDocument();
    manager.mockReturnValue(makeManager());
    rerender(<Component />);
    expect(
      screen.queryByRole("img", { name: /Syncing/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Nextcloud: Sync failed" }),
    ).toBeInTheDocument();
  });

  it("uses provider activity from the hook, including externally started sync", () => {
    manager.mockReturnValue({
      ...makeManager(),
      isSyncing: true,
      isProviderSyncing: (provider: string) => provider === "nextcloud",
    });
    render(<Component />);
    expect(
      screen.getByRole("img", { name: "Nextcloud: Syncing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "WebDAV: Sync failed" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "WebDAV: Syncing" }),
    ).not.toBeInTheDocument();
  });
});

it("uses the cloud with sync arrows for the settings entry", () => {
  expect(SETTINGS_TABS.find((tab) => tab.id === "cloudSync")?.icon).toBe(
    CloudSync,
  );
});

it("keeps the cloud glyph visible with reduced motion and supplies an accessible label", () => {
  render(<CloudSyncStatusIcon state="syncing" label="Syncing" />);
  expect(
    screen.getByRole("img", { name: "Syncing" }).querySelector("svg"),
  ).toHaveClass(
    "lucide-cloud-sync",
    "text-primary",
    "motion-safe:animate-pulse",
    "motion-reduce:animate-none",
  );
});

it("preserves the unrelated backup failure icon", () => {
  manager.mockReturnValue(makeManager());
  render(<SyncBackupStatusBar />);
  expect(
    screen.getByTestId("sync-status-bar").querySelector(".lucide-circle-alert"),
  ).toBeInTheDocument();
});
