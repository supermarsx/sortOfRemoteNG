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
      undefined,
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

  it("discards only a review aborted while queued without revoking another same-target request", async () => {
    const identity = cloudSyncTargetIdentity(target.id);
    const controller = new AbortController();
    engine.beforeRun.mockImplementationOnce(() => controller.abort());
    await expect(
      reviewCloudSyncTarget(target, config, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.review).not.toHaveBeenCalled();
    expect(cloudSyncTargetIdentity(target.id)).toBe(identity);
    expect(getCloudSyncActivity()).toHaveLength(0);
  });

  it("passes the review's signal through and discards a fulfillment after cancellation", async () => {
    const controller = new AbortController();
    engine.review.mockImplementation(
      async (_target, _config, _identity, signal) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        return receipt();
      },
    );
    await expect(
      reviewCloudSyncTarget(target, config, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(getCloudSyncActivity()).toHaveLength(0);
  });

  it("releases canceled review activity before a prior queue owner finishes and never starts its read later", async () => {
    let release!: () => void;
    engine.beforeRun.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const controller = new AbortController();
    const identity = cloudSyncTargetIdentity(target.id);
    const reviewing = reviewCloudSyncTarget(target, config, controller.signal);
    const canceled = reviewing.then(
      () => false,
      (error) => error.name === "AbortError",
    );
    const nextTurn = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), 0),
    );
    try {
      controller.abort();
      expect(await Promise.race([canceled, nextTurn])).toBe(true);
      expect(getCloudSyncActivity()).toHaveLength(0);
      expect(cloudSyncTargetIdentity(target.id)).toBe(identity);
      expect(engine.review).not.toHaveBeenCalled();
    } finally {
      release();
      await canceled;
    }
    await Promise.resolve();
    expect(engine.review).not.toHaveBeenCalled();
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
