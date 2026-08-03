import { describe, expect, it, vi } from "vitest";
import {
  restoreBackupCopy,
  restoreBackupTransaction,
} from "../../src/hooks/sync/useBackupStatus";

describe("backup restore command modes", () => {
  it("keeps verification restores read-only by default", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({ connections: [] });

    await restoreBackupCopy("1-aaaaaaaa", "target-a", invokeCommand);

    expect(invokeCommand).toHaveBeenCalledWith("backup_restore", {
      backupId: "1-aaaaaaaa",
      targetId: "target-a",
    });
  });

  it("opts user restores into the transactional backend commit", async () => {
    const invokeCommand = vi.fn().mockResolvedValue({
      connections: [{ id: "restored" }],
    });

    await restoreBackupTransaction("1-aaaaaaaa", "target-a", invokeCommand);

    expect(invokeCommand).toHaveBeenCalledWith("backup_restore", {
      backupId: "1-aaaaaaaa",
      targetId: "target-a",
      apply: true,
    });
  });
});
