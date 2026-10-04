import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultCloudSyncConfig,
  type CloudSyncTarget,
} from "../../src/types/settings/cloudSyncSettings";
import {
  cloudSyncTargetIdentity,
  getCloudSyncActivity,
  invalidateCloudSyncTarget,
} from "../../src/utils/services/cloudSyncActivity";
import {
  reviewCloudSyncTarget,
  resolveCloudSyncTarget,
} from "../../src/utils/services/cloudSyncService";
import type { CloudSyncConflictReview } from "../../src/utils/services/cloudSyncConflictReview";

const engine = vi.hoisted(() => ({
  review: vi.fn(),
  run: vi.fn(),
  beforeRun: vi.fn(),
}));
vi.mock("../../src/utils/services/cloudSyncEngine", () => ({
  CloudSyncConflict: class extends Error {},
  cloudSyncTransportOptions: () => ({}),
  reviewCloudSync: engine.review,
  runCloudSync: engine.run,
  serializeCloudSync: async (run: () => Promise<unknown>) => {
    await engine.beforeRun();
    return run();
  },
}));

const target: CloudSyncTarget = {
  id: "work",
  label: "Work",
  provider: "nextcloud",
  enabled: true,
};
const config = {
  ...defaultCloudSyncConfig,
  enabled: true,
  selectedItems: ["app:settings"],
};
const receipt = (): CloudSyncConflictReview => ({
  targetId: target.id,
  requestIdentity: cloudSyncTargetIdentity(target.id),
  reviewKey: "opaque",
  items: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  engine.beforeRun.mockReset();
  engine.run.mockReset();
  engine.review.mockReset();
});

describe("reviewed cloud sync operations", () => {
  it("reads through the sync queue and clears transient activity on success", async () => {
    const review = receipt();
    engine.review.mockImplementation(async () => {
      expect(getCloudSyncActivity()).toHaveLength(1);
      return review;
    });
    expect(await reviewCloudSyncTarget(target, config)).toEqual(review);
    expect(engine.review).toHaveBeenCalledWith(
      target,
      config,
      review.requestIdentity,
    );
    expect(engine.run).not.toHaveBeenCalled();
    expect(getCloudSyncActivity()).toHaveLength(0);
  });

  it("clears read activity when a database cannot be unlocked", async () => {
    engine.review.mockRejectedValue(new Error("Unlock the owning database"));
    await expect(reviewCloudSyncTarget(target, config)).rejects.toThrow(
      /Unlock/,
    );
    expect(getCloudSyncActivity()).toHaveLength(0);
  });

  it("does not read a destination invalidated while queued", async () => {
    engine.beforeRun.mockImplementationOnce(() =>
      invalidateCloudSyncTarget(target.id),
    );
    await expect(reviewCloudSyncTarget(target, config)).rejects.toThrow(
      /settings changed/,
    );
    expect(engine.review).not.toHaveBeenCalled();
    expect(getCloudSyncActivity()).toHaveLength(0);
  });

  it("keeps choices one-shot and passes their original review identity", async () => {
    const review = receipt();
    const choices = { "app:settings": "keepLocal" as const };
    engine.run.mockImplementation(async () => {
      expect(getCloudSyncActivity()).toHaveLength(1);
      return "Uploaded";
    });
    const result = await resolveCloudSyncTarget(
      target,
      config,
      review,
      choices,
    );
    expect(engine.run).toHaveBeenCalledWith(
      target,
      config,
      {
        review,
        choices,
      },
      review.requestIdentity,
    );
    expect(config.conflictResolution).toBe("askEveryTime");
    expect(result).toMatchObject({ status: "success", targetId: "work" });
    expect(result).not.toHaveProperty("review");
    expect(getCloudSyncActivity()).toHaveLength(0);
  });

  it("returns conflict status for stale choices and never retries them", async () => {
    engine.run.mockRejectedValue(
      Object.assign(new Error("Refresh the review"), { kind: "conflict" }),
    );
    const result = await resolveCloudSyncTarget(target, config, receipt(), {});
    expect(result).toMatchObject({
      status: "conflict",
      targetId: "work",
      message: "Refresh the review",
    });
    expect(engine.run).toHaveBeenCalledTimes(1);
    expect(getCloudSyncActivity()).toHaveLength(0);
  });
});
