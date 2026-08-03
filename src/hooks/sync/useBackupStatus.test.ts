import { describe, expect, it, vi } from "vitest";
import {
  BACKUP_TARGET_RECOVERY_GUIDANCE,
  deleteBackupCopy,
  discoverTestBackupTargets,
  verifyAndCleanupTestBackupCopies,
  type BackupCommandInvoker,
  type BackupStatus,
} from "./useBackupStatus";

const statusWithTargets = (
  targets: BackupStatus["lastTargetResults"],
): BackupStatus => ({
  isRunning: false,
  lastBackupStatus: "success",
  backupCount:
    targets?.filter((target) => target.status === "success").length ?? 0,
  totalSizeBytes: 0,
  lastTargetResults: targets,
});

describe("backup exact-target operations", () => {
  it("verifies and cleans every successful destination pair", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "backup_restore") {
        return { connections: [{ id: "test" }] };
      }
      return undefined;
    });
    const status = statusWithTargets([
      { targetId: "target-a", status: "success" },
      { targetId: "target-b", status: "success" },
      { targetId: "target-c", status: "failed" },
    ]);
    const discovery = await discoverTestBackupTargets(
      { id: "backup-1", checksum: "sum", targetId: "target-a" },
      vi.fn(async () => status),
    );

    await expect(
      verifyAndCleanupTestBackupCopies(
        "backup-1",
        discovery.targetIds,
        invokeCommand,
      ),
    ).resolves.toBe(2);
    expect(invokeCommand.mock.calls).toEqual([
      ["backup_restore", { backupId: "backup-1", targetId: "target-a" }],
      ["backup_delete", { backupId: "backup-1", targetId: "target-a" }],
      ["backup_restore", { backupId: "backup-1", targetId: "target-b" }],
      ["backup_delete", { backupId: "backup-1", targetId: "target-b" }],
    ]);
  });

  it("cleans all successful pairs even when one restore fails", async () => {
    const invokeCommand = vi.fn(
      async (command: string, args?: Record<string, unknown>) => {
        if (command === "backup_restore" && args?.targetId === "target-a") {
          throw new Error("corrupt payload");
        }
        if (command === "backup_restore") {
          return { connections: [{ id: "test" }] };
        }
        return undefined;
      },
    );

    await expect(
      verifyAndCleanupTestBackupCopies(
        "backup-2",
        ["target-a", "target-b"],
        invokeCommand,
      ),
    ).rejects.toThrow(/target-a: corrupt payload/);
    expect(invokeCommand).toHaveBeenCalledWith("backup_delete", {
      backupId: "backup-2",
      targetId: "target-a",
    });
    expect(invokeCommand).toHaveBeenCalledWith("backup_delete", {
      backupId: "backup-2",
      targetId: "target-b",
    });
  });

  it("rejects legacy rows before issuing a delete command", async () => {
    const invokeCommand = vi.fn(async () => undefined);

    await expect(
      deleteBackupCopy("legacy-backup", undefined, invokeCommand),
    ).rejects.toThrow(BACKUP_TARGET_RECOVERY_GUIDANCE);
    expect(invokeCommand).not.toHaveBeenCalled();
  });

  it("retries status discovery and includes every successful target", async () => {
    let attempts = 0;
    const status = statusWithTargets([
      { targetId: "target-a", status: "success" },
      { targetId: "target-b", status: "success" },
    ]);
    const invokeCommand: BackupCommandInvoker = vi.fn(
      async (command: string) => {
        expect(command).toBe("backup_get_status");
        attempts += 1;
        if (attempts === 1) throw new Error("service busy");
        return status;
      },
    );

    await expect(
      discoverTestBackupTargets(
        { id: "backup-3", checksum: "sum", targetId: "target-a" },
        invokeCommand,
      ),
    ).resolves.toEqual({
      targetIds: ["target-a", "target-b"],
      status,
    });
    expect(attempts).toBe(2);
  });

  it("falls back to the destination listing when status retries fail", async () => {
    const invokeCommand = vi.fn(async (command: string) => {
      if (command === "backup_get_status") {
        throw new Error("status unavailable");
      }
      if (command === "backup_list_all_targets") {
        return [
          {
            targetId: "target-a",
            targetLabel: "Primary",
            backups: [{ id: "backup-4" }],
          },
          {
            targetId: "target-b",
            targetLabel: "Mirror",
            backups: [{ id: "backup-4", targetId: "target-b" }],
          },
        ];
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const discovery = await discoverTestBackupTargets(
      { id: "backup-4", checksum: "sum", targetId: "target-a" },
      invokeCommand,
    );
    expect(discovery.targetIds).toEqual(["target-a", "target-b"]);
    expect(discovery.warning).toBeUndefined();
    expect(
      invokeCommand.mock.calls.filter(
        ([command]) => command === "backup_get_status",
      ),
    ).toHaveLength(2);
  });
});
