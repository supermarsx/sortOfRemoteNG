import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SyncStatusOverview from "../../src/components/SettingsDialog/sections/cloudSync/SyncStatusOverview";
import SyncTargetsSection from "../../src/components/SettingsDialog/sections/cloudSync/SyncTargetsSection";
import CloudSyncSettings from "../../src/components/SettingsDialog/sections/CloudSyncSettings";
import type { Mgr } from "../../src/components/SettingsDialog/sections/cloudSync/types";
import type { GlobalSettings } from "../../src/types/settings/settings";

const hook = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../../src/hooks/settings/useCloudSyncSettings", () => ({
  useCloudSyncSettings: () => hook.current,
  providerIcons: { googleDrive: null },
  providerLabels: { googleDrive: "Google Drive" },
}));
vi.mock("../../src/components/ui/InfoTooltip", () => ({
  InfoTooltip: () => null,
}));
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/AdvancedSection",
  () => ({ default: () => null }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/AuthTokenModal",
  () => ({ default: () => null }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/ConflictResolutionSection",
  () => ({ default: () => null }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/EnableSyncToggle",
  () => ({ default: () => null }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/EncryptionSection",
  () => ({ default: () => null }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/NotificationsGrid",
  () => ({ default: () => null }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/StartupShutdownGrid",
  () => ({ default: () => null }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/SyncFrequencySelect",
  () => ({ default: () => null }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/SyncItemsGrid",
  () => ({ default: () => null }),
);
vi.mock(
  "../../src/components/SettingsDialog/sections/cloudSync/ProviderConfig",
  () => ({ default: () => null }),
);

afterEach(cleanup);

function manager() {
  const statuses: Record<
    string,
    NonNullable<ReturnType<Mgr["getTargetStatus"]>>
  > = {
    personal: {
      provider: "googleDrive",
      lastSyncTime: 1_800_000_000,
      lastSyncStatus: "success",
    },
    work: {
      provider: "googleDrive",
      lastSyncTime: 1_800_000_100,
      lastSyncStatus: "failed",
      lastSuccessTime: 1_799_999_000,
      lastSyncError: "Access denied",
    },
  };
  const active = new Set<string>();
  const value = {
    cloudSync: { enabled: true },
    syncTargets: [
      {
        id: "personal",
        label: "Personal",
        provider: "googleDrive",
        enabled: true,
        googleDrive: { accessToken: "secret-token" },
      },
      { id: "work", label: "Work", provider: "googleDrive", enabled: true },
    ],
    getTargetStatus: vi.fn((id: string) => statuses[id]),
    isTargetSyncing: vi.fn((id: string) => active.has(id)),
    getSyncTimestampMs: (value?: number) =>
      value === undefined ? undefined : value * 1000,
    isSyncing: false,
    handleSyncTarget: vi.fn(),
    handleSyncNow: vi.fn(),
    handleTestTarget: vi.fn(),
    getTargetTestResult: vi.fn(),
    handleResolveConflict: vi.fn(),
    expandedTargetId: null,
    authTargetId: null,
  };
  return { value, mgr: value as unknown as Mgr, statuses, active };
}

describe("per-target cloud sync settings status", () => {
  it("keeps same-provider results, timestamps, errors and retry callbacks independent", () => {
    const { mgr, value } = manager();
    render(<SyncStatusOverview mgr={mgr} />);
    const personal = within(screen.getByRole("listitem", { name: "Personal" }));
    const work = within(screen.getByRole("listitem", { name: "Work" }));
    expect(personal.getByRole("status")).toHaveTextContent("Success");
    expect(work.getByRole("status")).toHaveTextContent("Failed");
    expect(personal.getByText("Google Drive")).toBeInTheDocument();
    expect(work.getByText("Google Drive")).toBeInTheDocument();
    expect(
      personal.getByText(/Last attempt:/).querySelector("time"),
    ).toHaveAttribute("dateTime", new Date(1_800_000_000_000).toISOString());
    expect(
      work.getByText(/Last success:/).querySelector("time"),
    ).toHaveAttribute("dateTime", new Date(1_799_999_000_000).toISOString());
    expect(personal.queryByText("Error details")).not.toBeInTheDocument();
    fireEvent.click(work.getByText("Error details"));
    expect(work.getByText("Access denied").closest("details")).toHaveAttribute(
      "open",
    );
    fireEvent.click(work.getByRole("button", { name: "Retry Work" }));
    expect(value.handleSyncTarget).toHaveBeenCalledExactlyOnceWith("work");
    expect(screen.queryByText(/Syncing to/)).not.toBeInTheDocument();
    expect(screen.queryByText("secret-token")).not.toBeInTheDocument();
  });

  it("retains history for disabled targets and when master sync is off", () => {
    const { mgr, value } = manager();
    value.syncTargets[1].enabled = false;
    const view = render(<SyncStatusOverview mgr={mgr} />);
    expect(screen.getByText("Target disabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Work" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sync Personal" })).toBeEnabled();
    value.cloudSync.enabled = false;
    view.rerender(<SyncStatusOverview mgr={mgr} />);
    expect(screen.getAllByText("Cloud sync disabled")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Sync Personal" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("status", { name: "Work sync status" }),
    ).toHaveTextContent("Failed");
  });

  it("shows only active targets as syncing and blocks other jobs", () => {
    const { mgr, value, active } = manager();
    active.add("work");
    value.isSyncing = true;
    render(<SyncStatusOverview mgr={mgr} />);
    expect(
      screen.getByRole("img", { name: "Syncing Work" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Syncing Personal" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", { name: "Work sync status" }),
    ).toHaveTextContent("Last result: Failed");
    for (const button of screen.getAllByRole("button"))
      expect(button).toBeDisabled();
  });

  it.each(["partial", "conflict"] as const)(
    "labels %s without relying on color",
    (result) => {
      const { mgr, statuses } = manager();
      statuses.work.lastSyncStatus = result;
      render(<SyncStatusOverview mgr={mgr} />);
      expect(
        screen.getByRole("status", { name: "Work sync status" }),
      ).toHaveTextContent(result === "partial" ? "Partial" : "Conflict");
    },
  );

  it("only resolves a conflict after the target-specific choice is clicked", () => {
    const { mgr, value, statuses } = manager();
    statuses.work.lastSyncStatus = "conflict";
    render(<SyncStatusOverview mgr={mgr} />);
    expect(value.handleResolveConflict).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Keep remote for Work" }),
    );
    expect(value.handleResolveConflict).toHaveBeenCalledExactlyOnceWith(
      "work",
      "keepRemote",
    );
  });

  it("renders independent read/write probe results and a real test callback", () => {
    const { mgr, value } = manager();
    value.getTargetTestResult.mockImplementation((id: string) =>
      id === "work"
        ? {
            status: "failed",
            canRead: true,
            canWrite: false,
            message: "Write denied",
            latencyMs: 12,
          }
        : undefined,
    );
    render(<SyncTargetsSection mgr={mgr} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Test connection for Personal" }),
    );
    expect(value.handleTestTarget).toHaveBeenCalledExactlyOnceWith("personal");
    expect(
      screen.getByRole("status", { name: "Work connection test" }),
    ).toHaveTextContent("Read: verified · Write: not verified · 12 ms");
    expect(
      screen.queryByRole("status", { name: "Personal connection test" }),
    ).not.toBeInTheDocument();
  });

  it("shows never attempted targets and renders nothing for an empty list", () => {
    const { mgr, statuses, value } = manager();
    delete statuses.personal;
    const view = render(<SyncStatusOverview mgr={mgr} />);
    const personal = within(screen.getByRole("listitem", { name: "Personal" }));
    expect(personal.getByRole("status")).toHaveTextContent("Not synced yet");
    expect(personal.getByText("Last attempt: Never")).toBeInTheDocument();
    fireEvent.click(personal.getByRole("button", { name: "Sync Personal" }));
    expect(value.handleSyncTarget).toHaveBeenCalledWith("personal");
    value.syncTargets = [];
    view.rerender(<SyncStatusOverview mgr={mgr} />);
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("reflects Sync All activity in target editor icons and respects the master switch", () => {
    const { mgr, value, active } = manager();
    active.add("personal");
    active.add("work");
    value.isSyncing = true;
    const view = render(<SyncTargetsSection mgr={mgr} />);
    expect(
      screen.getByRole("img", { name: "Syncing Personal" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Syncing Work" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sync Personal now" }),
    ).toBeDisabled();
    active.clear();
    value.isSyncing = false;
    value.cloudSync.enabled = false;
    view.rerender(<SyncTargetsSection mgr={mgr} />);
    expect(
      screen.getByRole("button", { name: "Sync Work now" }),
    ).toBeDisabled();
  });

  it("keeps the overview visible with master sync off and disables Sync All with no enabled targets", () => {
    const { value } = manager();
    hook.current = value;
    value.cloudSync.enabled = false;
    const props = { settings: {} as GlobalSettings, updateSettings: vi.fn() };
    const view = render(<CloudSyncSettings {...props} />);
    expect(
      screen.getByRole("list", { name: "Target sync status" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync All" })).toBeDisabled();
    value.cloudSync.enabled = true;
    value.syncTargets.forEach((target) => {
      target.enabled = false;
    });
    view.rerender(<CloudSyncSettings {...props} />);
    expect(screen.getByRole("button", { name: "Sync All" })).toBeDisabled();
    value.syncTargets[0].enabled = true;
    view.rerender(<CloudSyncSettings {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync All" }));
    expect(value.handleSyncNow).toHaveBeenCalledOnce();
  });
});
