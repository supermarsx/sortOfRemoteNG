import { describe, expect, it } from "vitest";
import { VncAdmissionController } from "./vncAdmissionController";

const expectAbort = async (request: Promise<unknown>): Promise<void> => {
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
};

describe("VncAdmissionController", () => {
  it("rejects invalid capacities", () => {
    for (const capacity of [0, -1, 1.5, Number.NaN, Number.MAX_VALUE]) {
      expect(() => new VncAdmissionController(capacity)).toThrow(RangeError);
    }
  });

  it("enforces its cap and grants live waiters in strict FIFO order", async () => {
    const admission = new VncAdmissionController(2);
    const first = await admission.acquire();
    const second = await admission.acquire();
    const order: number[] = [];
    const thirdRequest = admission.acquire().then((lease) => {
      order.push(3);
      return lease;
    });
    const fourthRequest = admission.acquire().then((lease) => {
      order.push(4);
      return lease;
    });

    expect(admission.activeCount).toBe(2);
    expect(admission.waitingCount).toBe(2);

    second.release();
    const third = await thirdRequest;
    expect(order).toEqual([3]);
    expect(admission.activeCount).toBe(2);
    expect(admission.waitingCount).toBe(1);

    first.release();
    const fourth = await fourthRequest;
    expect(order).toEqual([3, 4]);
    expect(admission.activeCount).toBe(2);
    expect(admission.waitingCount).toBe(0);

    third.release();
    fourth.release();
    expect(admission.activeCount).toBe(0);
  });

  it("removes an aborted waiter immediately and advances a live follower", async () => {
    const admission = new VncAdmissionController(1);
    const active = await admission.acquire();
    const canceledController = new AbortController();
    const canceled = admission.acquire(canceledController.signal);
    const live = admission.acquire();

    expect(admission.waitingCount).toBe(2);
    canceledController.abort();
    expect(admission.waitingCount).toBe(1);
    await expectAbort(canceled);

    active.release();
    const liveLease = await live;
    expect(admission.activeCount).toBe(1);
    expect(admission.waitingCount).toBe(0);
    liveLease.release();
  });

  it("settles abort versus grant races exactly once", async () => {
    const abortFirstAdmission = new VncAdmissionController(1);
    const abortFirstActive = await abortFirstAdmission.acquire();
    const abortedController = new AbortController();
    const aborted = abortFirstAdmission.acquire(abortedController.signal);
    const abortFirstFollower = abortFirstAdmission.acquire();
    abortedController.abort();
    abortFirstActive.release();
    await expectAbort(aborted);
    const abortFirstFollowerLease = await abortFirstFollower;
    abortFirstFollowerLease.release();
    expect(abortFirstAdmission.activeCount).toBe(0);

    const grantFirstAdmission = new VncAdmissionController(1);
    const grantFirstActive = await grantFirstAdmission.acquire();
    const grantedController = new AbortController();
    const granted = grantFirstAdmission.acquire(grantedController.signal);
    const grantFirstFollower = grantFirstAdmission.acquire();
    grantFirstActive.release();
    grantedController.abort();
    const grantedLease = await granted;
    expect(grantFirstAdmission.activeCount).toBe(1);
    expect(grantFirstAdmission.waitingCount).toBe(1);
    grantedLease.release();
    const grantFirstFollowerLease = await grantFirstFollower;
    grantFirstFollowerLease.release();
    expect(grantFirstAdmission.activeCount).toBe(0);
  });

  it("mass-cancels queued work without leaking waiters or permits", async () => {
    const admission = new VncAdmissionController(2);
    const first = await admission.acquire();
    const second = await admission.acquire();
    const controllers = Array.from(
      { length: 1_000 },
      () => new AbortController(),
    );
    const canceled = controllers.map((controller) =>
      admission.acquire(controller.signal),
    );

    expect(admission.activeCount).toBe(2);
    expect(admission.waitingCount).toBe(1_000);
    controllers.forEach((controller) => controller.abort());
    expect(admission.waitingCount).toBe(0);
    const outcomes = await Promise.allSettled(canceled);
    expect(
      outcomes.every(
        (outcome) =>
          outcome.status === "rejected" &&
          outcome.reason?.name === "AbortError",
      ),
    ).toBe(true);

    first.release();
    first.release();
    second.release();
    expect(admission.activeCount).toBe(0);

    const replacementA = await admission.acquire();
    const replacementB = await admission.acquire();
    const queued = admission.acquire();
    expect(admission.activeCount).toBe(2);
    expect(admission.waitingCount).toBe(1);
    replacementA.release();
    const replacementC = await queued;
    expect(admission.activeCount).toBe(2);
    replacementB.release();
    replacementC.release();
    expect(admission.activeCount).toBe(0);
  });

  it("rejects an already-aborted acquisition without consuming a permit", async () => {
    const admission = new VncAdmissionController(1);
    const controller = new AbortController();
    controller.abort();

    await expectAbort(admission.acquire(controller.signal));
    expect(admission.activeCount).toBe(0);
    expect(admission.waitingCount).toBe(0);

    const lease = await admission.acquire();
    expect(admission.activeCount).toBe(1);
    lease.release();
  });
});
