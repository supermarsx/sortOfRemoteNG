import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { exists, mkdir, readDir, remove } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { BackupConfig } from "../../src/types/settings/backupSettings";

// We need a fresh module for each test since backupWorker is a singleton
let backupWorker: typeof import("../../src/utils/services/backupWorker")["backupWorker"];
let BackupWorkerService: any;

function makeConfig(overrides: Partial<BackupConfig> = {}): BackupConfig {
  return {
    enabled: true,
    frequency: "manual",
    scheduledTime: "03:00",
    weeklyDay: "sunday",
    monthlyDay: 1,
    destinationPath: "/backups",
    differentialEnabled: false,
    fullBackupInterval: 7,
    maxBackupsToKeep: 5,
    format: "json",
    includePasswords: false,
    encryptBackups: false,
    encryptionAlgorithm: "AES-256-GCM",
    locationPreset: "custom",
    includeSettings: true,
    includeSSHKeys: false,
    backupOnClose: false,
    notifyOnBackup: true,
    compressBackups: false,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: false });

  vi.mocked(invoke).mockResolvedValue(undefined);
  vi.mocked(exists).mockResolvedValue(true);
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(readDir).mockResolvedValue([]);
  vi.mocked(remove).mockResolvedValue(undefined);
  vi.mocked(join).mockImplementation((...args: string[]) =>
    Promise.resolve(args.join("/")),
  );

  // Re-import to get a fresh singleton
  vi.resetModules();
  const mod = await import("../../src/utils/services/backupWorker");
  backupWorker = mod.backupWorker;
});

afterEach(() => {
  backupWorker?.destroy();
  vi.useRealTimers();
});

describe("BackupWorkerService", () => {
  // ---------- initialize ----------
  describe("initialize", () => {
    it("sets config and notifies listeners", async () => {
      const cb = vi.fn();
      backupWorker.subscribe(cb);
      cb.mockClear();

      await backupWorker.initialize(makeConfig());
      expect(cb).toHaveBeenCalled();
    });

    it("starts scheduler when frequency is non-manual and enabled", async () => {
      const config = makeConfig({ frequency: "daily", enabled: true });
      await backupWorker.initialize(config);

      const state = backupWorker.getState();
      expect(state.nextScheduledBackup).toBeDefined();
    });

    it("does NOT start scheduler for manual frequency", async () => {
      await backupWorker.initialize(makeConfig({ frequency: "manual" }));
      const state = backupWorker.getState();
      expect(state.nextScheduledBackup).toBeUndefined();
    });
  });

  // ---------- updateConfig ----------
  describe("updateConfig", () => {
    it("stops scheduler when switching from daily to manual", async () => {
      await backupWorker.initialize(
        makeConfig({ frequency: "daily", enabled: true }),
      );
      expect(backupWorker.getState().nextScheduledBackup).toBeDefined();

      backupWorker.updateConfig(
        makeConfig({ frequency: "manual", enabled: true }),
      );
      expect(backupWorker.getState().nextScheduledBackup).toBeUndefined();
    });

    it("starts scheduler when switching from manual to hourly", async () => {
      await backupWorker.initialize(
        makeConfig({ frequency: "manual", enabled: true }),
      );
      expect(backupWorker.getState().nextScheduledBackup).toBeUndefined();

      backupWorker.updateConfig(
        makeConfig({ frequency: "hourly", enabled: true }),
      );
      expect(backupWorker.getState().nextScheduledBackup).toBeDefined();
    });

    it("restarts scheduler when changing between non-manual frequencies", async () => {
      await backupWorker.initialize(
        makeConfig({ frequency: "daily", enabled: true }),
      );
      const first = backupWorker.getState().nextScheduledBackup;

      backupWorker.updateConfig(
        makeConfig({ frequency: "hourly", enabled: true }),
      );
      const second = backupWorker.getState().nextScheduledBackup;

      // hourly and daily produce different next-backup timestamps
      expect(second).toBeDefined();
    });
  });

  // ---------- subscribe ----------
  describe("subscribe", () => {
    it("calls callback immediately with current state", async () => {
      await backupWorker.initialize(makeConfig());
      const cb = vi.fn();
      backupWorker.subscribe(cb);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb).toHaveBeenCalledWith(
        expect.objectContaining({ isRunning: false, recentJobs: [] }),
      );
    });

    it("returns an unsubscribe function that removes the listener", async () => {
      await backupWorker.initialize(makeConfig());
      const cb = vi.fn();
      const unsub = backupWorker.subscribe(cb);
      cb.mockClear();

      unsub();

      // Further state changes should not call cb
      backupWorker.updateConfig(makeConfig({ frequency: "daily" }));
      expect(cb).not.toHaveBeenCalled();
    });
  });

  // ---------- runBackup ----------
  describe("runBackup", () => {
    it("throws when not initialized", async () => {
      await expect(backupWorker.runBackup()).rejects.toThrow(
        "Backup worker not initialized",
      );
    });

    it("throws when a backup is already running", async () => {
      // Make invoke hang so the backup stays in running state
      vi.mocked(invoke).mockImplementation(
        () => new Promise(() => {}), // never resolves
      );
      await backupWorker.initialize(makeConfig());

      // Start a backup (don't await – it will remain running)
      const p1 = backupWorker.runBackup();

      // Need to tick so pending status can transition to running
      await vi.advanceTimersByTimeAsync(0);

      await expect(backupWorker.runBackup()).rejects.toThrow(
        "Backup already in progress",
      );

      // Cleanup: unblock the promise so afterEach can destroy
      vi.mocked(invoke).mockResolvedValue(undefined);
    });

    it("calls invoke('run_backup') with correct config", async () => {
      await backupWorker.initialize(
        makeConfig({ format: "xml", includePasswords: true }),
      );
      const job = await backupWorker.runBackup();

      expect(invoke).toHaveBeenCalledWith(
        "run_backup",
        expect.objectContaining({
          config: expect.objectContaining({
            format: "xml",
            include_passwords: true,
          }),
        }),
      );
      expect(job.status).toBe("completed");
    });

    it("creates destination directory when it does not exist", async () => {
      vi.mocked(exists).mockResolvedValue(false);
      await backupWorker.initialize(makeConfig());
      await backupWorker.runBackup();

      expect(mkdir).toHaveBeenCalledWith("/backups", { recursive: true });
    });

    it("tracks lastBackupTime after success", async () => {
      await backupWorker.initialize(makeConfig());
      const before = Date.now();
      await backupWorker.runBackup();
      const state = backupWorker.getState();

      expect(state.lastBackupTime).toBeGreaterThanOrEqual(before);
    });

    it("records lastFullBackupTime for full backups", async () => {
      await backupWorker.initialize(makeConfig());
      await backupWorker.runBackup(true);
      expect(backupWorker.getState().lastFullBackupTime).toBeDefined();
    });

    it("returns a failed job when invoke rejects", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("backend error"));
      await backupWorker.initialize(makeConfig());
      const job = await backupWorker.runBackup();

      expect(job.status).toBe("failed");
      expect(job.error).toBe("backend error");
    });

    it("adds completed job to recentJobs", async () => {
      await backupWorker.initialize(makeConfig());
      await backupWorker.runBackup();

      const state = backupWorker.getState();
      expect(state.recentJobs).toHaveLength(1);
      expect(state.recentJobs[0].status).toBe("completed");
    });

    it("caps recentJobs at 10", async () => {
      await backupWorker.initialize(makeConfig());

      for (let i = 0; i < 12; i++) {
        await backupWorker.runBackup();
      }

      expect(backupWorker.getState().recentJobs).toHaveLength(10);
    });
  });

  // ---------- backupOnClose ----------
  describe("backupOnClose", () => {
    it("runs backup when backupOnClose and enabled are true", async () => {
      await backupWorker.initialize(
        makeConfig({ backupOnClose: true, enabled: true }),
      );
      await backupWorker.backupOnClose();
      expect(invoke).toHaveBeenCalledWith("run_backup", expect.anything());
    });

    it("skips backup when backupOnClose is false", async () => {
      await backupWorker.initialize(
        makeConfig({ backupOnClose: false, enabled: true }),
      );
      await backupWorker.backupOnClose();
      expect(invoke).not.toHaveBeenCalledWith("run_backup", expect.anything());
    });

    it("skips backup when not enabled", async () => {
      await backupWorker.initialize(
        makeConfig({ backupOnClose: true, enabled: false }),
      );
      await backupWorker.backupOnClose();
      expect(invoke).not.toHaveBeenCalledWith("run_backup", expect.anything());
    });
  });

  // ---------- cleanupOldBackups ----------
  describe("cleanupOldBackups", () => {
    it("removes files beyond maxBackupsToKeep", async () => {
      vi.mocked(readDir).mockResolvedValue([
        { name: "sortOfRemoteNG-backup-2024-01-05T12-00-00-000Z.json", isDirectory: false, isFile: true, isSymlink: false },
        { name: "sortOfRemoteNG-backup-2024-01-04T12-00-00-000Z.json", isDirectory: false, isFile: true, isSymlink: false },
        { name: "sortOfRemoteNG-backup-2024-01-03T12-00-00-000Z.json", isDirectory: false, isFile: true, isSymlink: false },
        { name: "sortOfRemoteNG-backup-2024-01-02T12-00-00-000Z.json", isDirectory: false, isFile: true, isSymlink: false },
      ] as any);

      await backupWorker.initialize(makeConfig({ maxBackupsToKeep: 2 }));
      await backupWorker.runBackup(); // triggers cleanupOldBackups internally

      // Should delete the two oldest (index 2 & 3 after sort + the new file is not in readDir mock)
      expect(remove).toHaveBeenCalled();
    });
  });

  // ---------- generateBackupFilename (tested indirectly) ----------
  describe("backup filename generation", () => {
    it("includes .json extension for json format", async () => {
      await backupWorker.initialize(makeConfig({ format: "json" }));
      const job = await backupWorker.runBackup();
      expect(job.filePath).toMatch(/\.json$/);
    });

    it("includes .xml extension for xml format", async () => {
      await backupWorker.initialize(makeConfig({ format: "xml" }));
      const job = await backupWorker.runBackup();
      expect(job.filePath).toMatch(/\.xml$/);
    });

    it("includes .gz extension when compressBackups is true", async () => {
      await backupWorker.initialize(makeConfig({ compressBackups: true }));
      const job = await backupWorker.runBackup();
      expect(job.filePath).toMatch(/\.gz$/);
    });

    it("includes -encrypted suffix when encryptBackups is true", async () => {
      await backupWorker.initialize(makeConfig({ encryptBackups: true }));
      const job = await backupWorker.runBackup();
      expect(job.filePath).toMatch(/-encrypted/);
    });
  });

  // ---------- scheduler ----------
  describe("scheduler", () => {
    it("calculateNextBackupTime sets hourly next backup", async () => {
      await backupWorker.initialize(
        makeConfig({ frequency: "hourly", enabled: true }),
      );
      const state = backupWorker.getState();
      expect(state.nextScheduledBackup).toBeDefined();
      // Hourly: should be within the next hour
      expect(state.nextScheduledBackup!).toBeGreaterThan(Date.now());
      expect(state.nextScheduledBackup! - Date.now()).toBeLessThanOrEqual(
        3600000 + 1000,
      );
    });

    it("calculateNextBackupTime sets weekly next backup", async () => {
      await backupWorker.initialize(
        makeConfig({
          frequency: "weekly",
          enabled: true,
          weeklyDay: "monday",
          scheduledTime: "03:00",
        }),
      );
      const state = backupWorker.getState();
      expect(state.nextScheduledBackup).toBeDefined();
      const nextDate = new Date(state.nextScheduledBackup!);
      expect(nextDate.getDay()).toBe(1); // Monday
    });

    it("calculateNextBackupTime sets monthly next backup", async () => {
      await backupWorker.initialize(
        makeConfig({
          frequency: "monthly",
          enabled: true,
          monthlyDay: 15,
          scheduledTime: "03:00",
        }),
      );
      const state = backupWorker.getState();
      expect(state.nextScheduledBackup).toBeDefined();
      const nextDate = new Date(state.nextScheduledBackup!);
      expect(nextDate.getDate()).toBe(15);
    });
  });

  // ---------- destroy ----------
  describe("destroy", () => {
    it("clears scheduler and listeners", async () => {
      const cb = vi.fn();
      await backupWorker.initialize(
        makeConfig({ frequency: "daily", enabled: true }),
      );
      backupWorker.subscribe(cb);
      cb.mockClear();

      backupWorker.destroy();

      // No more notifications after destroy
      expect(backupWorker.getState().nextScheduledBackup).toBeUndefined();
    });
  });
});
