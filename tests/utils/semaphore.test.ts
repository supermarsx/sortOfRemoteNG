import { describe, it, expect } from "vitest";
import { Semaphore } from "../../src/utils/core/semaphore";

describe("Semaphore", () => {
  it("allows immediate acquisition when permits are available", async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    // both acquired without blocking
    sem.release();
    sem.release();
  });

  it("blocks when all permits are taken", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let acquired = false;
    const pending = sem.acquire().then(() => {
      acquired = true;
    });

    // give a tick to see if the second acquire resolves
    await new Promise((r) => setTimeout(r, 50));
    expect(acquired).toBe(false);

    sem.release();
    await pending;
    expect(acquired).toBe(true);
    sem.release();
  });

  it("queues multiple waiters and resolves in order", async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));

    sem.release();
    await p1;
    sem.release();
    await p2;
    sem.release();

    expect(order).toEqual([1, 2]);
  });
});
