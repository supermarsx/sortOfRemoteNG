import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudSyncErrorMessage } from "../../src/components/sync/CloudSyncErrorMessage";
import { CloudSyncStatusPopup } from "../../src/components/sync/CloudSyncStatusPopup";
import SyncStatusOverview from "../../src/components/SettingsDialog/sections/cloudSync/SyncStatusOverview";
import SyncTargetsSection from "../../src/components/SettingsDialog/sections/cloudSync/SyncTargetsSection";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import {
  cloudSyncErrorMessage,
  unavailableCloudSyncDatabaseIds,
} from "../../src/utils/settings/cloudSyncPresentation";

const mocks = vi.hoisted(() => ({
  manager: vi.fn(),
  databases: vi.fn(),
  unlock: vi.fn(),
  select: vi.fn(),
  loadData: vi.fn(),
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getAllDatabases: mocks.databases,
      unlockManagedDatabase: mocks.unlock,
      selectDatabase: mocks.select,
      loadDatabaseData: mocks.loadData,
    }),
  },
}));
vi.mock("../../src/hooks/sync/useCloudSyncStatus", () => ({
  useCloudSyncStatus: mocks.manager,
  PROVIDER_NAMES: { nextcloud: "Nextcloud" },
  formatRelativeTime: () => "Never",
}));
vi.mock("../../src/hooks/settings/useCloudSyncSettings", () => ({
  providerIcons: { nextcloud: null },
  providerLabels: { nextcloud: "Nextcloud" },
}));
vi.mock("../../src/components/ui/InfoTooltip", () => ({
  InfoTooltip: () => null,
}));
vi.mock("../../src/components/ui/overlays/ToolbarPopover", () => ({
  ToolbarPopover: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolbarPopoverHeader: () => null,
}));

const unavailable = (id: string) =>
  `Selected cloud sync artifact "database:${id}" is unavailable. Open and unlock this database before syncing.`;

function popupManager() {
  return {
    t: (_key: string, fallback: string) => fallback,
    isOpen: true,
    setIsOpen: vi.fn(),
    dropdownRef: React.createRef<HTMLDivElement>(),
    isSyncing: false,
    hasSync: true,
    isProviderSyncing: () => false,
    enabledProviders: ["nextcloud"],
    config: {
      frequency: "manual",
      providerStatus: {
        nextcloud: {
          lastSyncStatus: "failed",
          lastSyncError: unavailable("work"),
        },
      },
    },
    getLastSyncTime: () => undefined,
    handleSyncAll: vi.fn(),
    handleSyncProvider: vi.fn(),
    handleTestAll: vi.fn(),
    handleTestProvider: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.databases.mockResolvedValue([{ id: "work", name: "Work database" }]);
  mocks.manager.mockReturnValue(popupManager());
});
afterEach(cleanup);

describe("friendly cloud sync errors", () => {
  it("uses friendly database names without removing unlock guidance or disclosing IDs", () => {
    const message = unavailable("work");
    expect(
      cloudSyncErrorMessage(message, new Map([["work", "Work database"]])),
    ).toBe(
      "Database “Work database” is unavailable for cloud sync. Open and unlock this database before syncing.",
    );
    expect(cloudSyncErrorMessage(message)).toBe(
      "A selected database is unavailable for cloud sync. Open and unlock this database before syncing.",
    );
    expect(cloudSyncErrorMessage("Access denied")).toBe("Access denied");
    expect(
      unavailableCloudSyncDatabaseIds(
        `${message}; ${message}; ${unavailable("other")}`,
      ),
    ).toEqual(["work", "other"]);
  });

  it("resolves only metadata and never unlocks, selects or loads database contents", async () => {
    let finish!: (rows: { id: string; name: string }[]) => void;
    mocks.databases.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <CloudSyncErrorMessage message={unavailable("work")} />,
    );
    expect(view.container).toHaveTextContent(
      "A selected database is unavailable",
    );
    expect(view.container).not.toHaveTextContent("database:work");
    await act(async () => finish([{ id: "work", name: "Work <img src=x>" }]));
    expect(view.container).toHaveTextContent(
      "Database “Work <img src=x>” is unavailable",
    );
    expect(view.container.querySelector("img")).toBeNull();
    expect(mocks.databases).toHaveBeenCalledOnce();
    expect(mocks.unlock).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.loadData).not.toHaveBeenCalled();
  });

  it.each(["missing", "failed"])(
    "keeps a safe actionable fallback when metadata is %s",
    async (outcome) => {
      if (outcome === "missing") mocks.databases.mockResolvedValue([]);
      else mocks.databases.mockRejectedValue(new Error("Unavailable metadata"));
      const view = render(
        <CloudSyncErrorMessage message={unavailable("opaque-uuid")} />,
      );
      await act(async () => {});
      expect(view.container).toHaveTextContent(
        "A selected database is unavailable for cloud sync",
      );
      expect(view.container).toHaveTextContent(
        "Open and unlock this database before syncing",
      );
      expect(view.container).not.toHaveTextContent("opaque-uuid");
      expect(mocks.unlock).not.toHaveBeenCalled();
      expect(mocks.select).not.toHaveBeenCalled();
      expect(mocks.loadData).not.toHaveBeenCalled();
    },
  );

  it("does not let an old metadata read replace the current error", async () => {
    let finish!: (rows: { id: string; name: string }[]) => void;
    mocks.databases.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <CloudSyncErrorMessage message={unavailable("work")} />,
    );
    view.rerender(<CloudSyncErrorMessage message="Access denied" />);
    await act(async () => finish([{ id: "work", name: "Old database" }]));
    expect(view.container).toHaveTextContent(/^Access denied$/);
    expect(mocks.databases).toHaveBeenCalledOnce();
  });

  it("leaves already friendly and unrelated errors alone without reading metadata", () => {
    const message =
      "Database “Work” is unavailable for cloud sync. Unlock it before retrying.";
    const view = render(<CloudSyncErrorMessage message={message} />);
    expect(view.container).toHaveTextContent(message);
    expect(mocks.databases).not.toHaveBeenCalled();
  });
});

describe("cloud sync action placement", () => {
  it("keeps tests out of the status popup and links to the Cloud Sync settings tab", async () => {
    const mgr = popupManager();
    mocks.manager.mockReturnValue(mgr);
    const open = vi.fn();
    render(<CloudSyncStatusPopup onOpenSettings={open} />);
    expect(screen.queryByTitle("Test All Connections")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Test Connection")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Test" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Connection tests are in Sync Settings",
      }),
    );
    expect(open).toHaveBeenCalledExactlyOnceWith("cloudSync");
    expect(mgr.setIsOpen).toHaveBeenCalledExactlyOnceWith(false);
    expect(mgr.handleTestAll).not.toHaveBeenCalled();
    expect(mgr.handleTestProvider).not.toHaveBeenCalled();
    await screen.findByText(/Database “Work database” is unavailable/);
  });

  it("exposes an explicit provider retry and disables it during sync", async () => {
    const mgr = popupManager();
    mocks.manager.mockReturnValue(mgr);
    const view = render(<CloudSyncStatusPopup />);
    await screen.findByText(/Database “Work database” is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Retry Nextcloud" }));
    expect(mgr.handleSyncProvider).toHaveBeenCalledExactlyOnceWith("nextcloud");
    mgr.isSyncing = true;
    view.rerender(<CloudSyncStatusPopup />);
    const retry = screen.getByRole("button", { name: "Retry Nextcloud" });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(mgr.handleSyncProvider).toHaveBeenCalledOnce();
  });

  it("keeps named-target testing and retry in Settings, without claiming a probe synced data", async () => {
    const retry = vi.fn();
    const test = vi.fn();
    const value = {
      cloudSync: { enabled: true },
      syncTargets: [
        {
          id: "work-target",
          label: "Work cloud",
          provider: "nextcloud",
          enabled: true,
        },
      ],
      isTargetSyncing: () => false,
      getSyncTimestampMs: () => undefined,
      getTargetStatus: () => ({
        lastSyncStatus: "failed",
        lastSyncError: unavailable("work"),
      }),
      getTargetTestResult: () => undefined,
      handleSyncTarget: retry,
      handleTestTarget: test,
      expandedTargetId: null,
      isBusy: false,
      isSyncing: false,
    };
    const mgr = value as unknown as Mgr;
    const view = render(
      <>
        <SyncStatusOverview mgr={mgr} />
        <SyncTargetsSection mgr={mgr} />
      </>,
    );
    await screen.findByText(/Database “Work database” is unavailable/);
    fireEvent.click(screen.getByRole("button", { name: "Retry Work cloud" }));
    expect(retry).toHaveBeenCalledExactlyOnceWith("work-target");
    fireEvent.click(
      screen.getByRole("button", { name: "Test connection for Work cloud" }),
    );
    expect(test).toHaveBeenCalledExactlyOnceWith("work-target");
    expect(
      screen.getByText(/does not sync your selected data/),
    ).toBeInTheDocument();
    value.isBusy = true;
    view.rerender(
      <>
        <SyncStatusOverview mgr={mgr} />
        <SyncTargetsSection mgr={mgr} />
      </>,
    );
    expect(
      screen.getByRole("button", { name: "Retry Work cloud" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Test connection for Work cloud" }),
    ).toBeDisabled();
    await waitFor(() => expect(mocks.databases).toHaveBeenCalledOnce());
  });
});
