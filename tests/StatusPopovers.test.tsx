import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BackupStatusPopup } from "../src/components/BackupStatusPopup";
import { CloudSyncStatusPopup } from "../src/components/CloudSyncStatusPopup";
import { SyncBackupStatusBar } from "../src/components/SyncBackupStatusBar";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  dispatch: vi.fn(),
  saveSettings: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("../src/contexts/useConnections", () => ({
  useConnections: () => ({
    dispatch: mocks.dispatch,
  }),
}));

vi.mock("../src/utils/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      saveSettings: mocks.saveSettings,
    }),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOptions?: string | Record<string, unknown>,
      maybeOptions?: Record<string, unknown>,
    ) => {
      const template =
        typeof defaultOrOptions === "string" ? defaultOrOptions : key;
      const options =
        typeof defaultOrOptions === "object"
          ? defaultOrOptions
          : maybeOptions || {};
      return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) =>
        String(options[token] ?? ""),
      );
    },
  }),
}));

const backupStatusFixture = {
  isRunning: false,
  backupCount: 0,
  totalSizeBytes: 0,
};

describe("Status popovers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "backup_get_status") return backupStatusFixture;
      if (command === "backup_list") return [];
      if (command === "backup_run_now") return { id: "b1", checksum: "x" };
      return null;
    });
  });

  it("opens/closes BackupStatusPopup", async () => {
    render(<BackupStatusPopup />);

    fireEvent.click(screen.getByTitle("Backup Status"));
    await waitFor(() => {
      expect(screen.getByTestId("backup-status-popover")).toBeInTheDocument();
    });

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(
        screen.queryByTestId("backup-status-popover"),
      ).not.toBeInTheDocument();
    });
  });

  it("opens/closes CloudSyncStatusPopup", async () => {
    render(<CloudSyncStatusPopup />);

    fireEvent.click(screen.getByTitle("Cloud Sync Status"));
    await waitFor(() => {
      expect(
        screen.getByTestId("cloud-sync-status-popover"),
      ).toBeInTheDocument();
    });

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(
        screen.queryByTestId("cloud-sync-status-popover"),
      ).not.toBeInTheDocument();
    });
  });

  it("opens/closes SyncBackupStatusBar popover", async () => {
    render(<SyncBackupStatusBar />);

    fireEvent.click(screen.getByTitle("Sync & Backup Status"));
    await waitFor(() => {
      expect(
        screen.getByTestId("sync-backup-status-popover"),
      ).toBeInTheDocument();
    });

    fireEvent.mouseDown(document.body);
    await waitFor(() => {
      expect(
        screen.queryByTestId("sync-backup-status-popover"),
      ).not.toBeInTheDocument();
    });
  });
});
