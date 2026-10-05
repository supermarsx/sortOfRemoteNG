import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), dispatch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => false,
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [] },
    dispatch: mocks.dispatch,
  }),
}));
vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: { getInstance: () => ({}) },
}));
vi.mock("../../src/utils/services/trustPortability", () => ({
  applyTrustDocument: vi.fn(async () => undefined),
  readTrustDocument: vi.fn(),
}));
import { useBackupStatus } from "../../src/hooks/sync/useBackupStatus";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("hydrates exactly the timestamp evidence committed by backup restore, without local-zone parsing or clock defaults", async () => {
  const connections = [
    {
      id: "legacy",
      createdAt: "2026-09-26T12:00:00",
      updatedAt: "2026-10-25T01:30:00",
    },
    {
      id: "offset",
      createdAt: "2026-09-26T08:00:00-04:00",
      updatedAt: "2026-09-26T08:00:00-04:00",
    },
    { id: "missing" },
    { id: "epoch", createdAt: 0, updatedAt: 0 },
  ];
  mocks.invoke.mockResolvedValue({ connections });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  const { result } = renderHook(() => useBackupStatus());
  await act(async () => {
    await result.current.handleRestoreBackup(
      "fixture-backup",
      "fixture-target",
    );
  });
  expect(mocks.invoke).toHaveBeenCalledWith("backup_restore", {
    backupId: "fixture-backup",
    targetId: "fixture-target",
    apply: true,
  });
  expect(mocks.dispatch).toHaveBeenCalledWith({
    type: "SET_CONNECTIONS",
    payload: connections,
  });
  expect(result.current.restoreResult?.success).toBe(true);
});
