import { describe, expect, it, vi } from "vitest";
import {
  SerialOutputStream,
  SerialSendQueue,
  SERIAL_SEND_BATCH_BYTES,
} from "./serialIo";

const bytes = (...values: number[]) => Uint8Array.from(values);

describe("SerialSendQueue", () => {
  it("coalesces same-tick sends into one ordered write", async () => {
    const writes: number[][] = [];
    const queue = new SerialSendQueue({
      write: async (data) => {
        writes.push(Array.from(data));
      },
    });
    await Promise.all([
      queue.enqueue(bytes(1)),
      queue.enqueue(bytes(2)),
      queue.enqueue(bytes(3, 4)),
    ]);
    expect(writes).toEqual([[1, 2, 3, 4]]);
  });

  it("never runs two writes concurrently and keeps order across ticks", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: number[] = [];
    const queue = new SerialSendQueue({
      write: async (data) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(...data);
        inFlight -= 1;
      },
    });
    const pending: Promise<void>[] = [];
    for (let i = 0; i < 20; i += 1) {
      pending.push(queue.enqueue(bytes(i)));
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(pending);
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it("splits a 100 KB paste into batches no larger than the cap", async () => {
    const sizes: number[] = [];
    const received: number[] = [];
    const queue = new SerialSendQueue({
      write: async (data) => {
        sizes.push(data.byteLength);
        received.push(data[0]);
      },
    });
    const paste = new Uint8Array(100 * 1024).map((_, i) => i % 251);
    await queue.enqueue(paste);
    expect(sizes.every((size) => size <= SERIAL_SEND_BATCH_BYTES)).toBe(true);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(paste.byteLength);
    expect(sizes.length).toBe(7);
  });

  it("retries a failed write once and then succeeds", async () => {
    const write = vi
      .fn<(data: Uint8Array) => Promise<void>>()
      .mockRejectedValueOnce(
        new Error("Serial command expired before execution"),
      )
      .mockResolvedValue(undefined);
    const queue = new SerialSendQueue({ write });
    await expect(queue.enqueue(bytes(65))).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("rejects the carried sends after two failures but keeps serving later sends", async () => {
    const write = vi
      .fn<(data: Uint8Array) => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const queue = new SerialSendQueue({ write });
    await expect(queue.enqueue(bytes(1))).rejects.toThrow("boom");
    await expect(queue.enqueue(bytes(2))).resolves.toBeUndefined();
    expect(queue.pendingBytes).toBe(0);
  });

  it("reports backlog while a large amount is queued", async () => {
    const states: boolean[] = [];
    const queue = new SerialSendQueue({
      write: async () => {},
      onBacklogChange: (value) => states.push(value),
      backlogBytes: 1024,
    });
    await queue.enqueue(new Uint8Array(4096));
    expect(states).toEqual([true, false]);
  });

  it("clear rejects queued sends", async () => {
    let release: () => void = () => {};
    const queue = new SerialSendQueue({
      write: () => new Promise<void>((resolve) => (release = resolve)),
    });
    const first = queue.enqueue(bytes(1));
    await Promise.resolve();
    await Promise.resolve();
    const second = queue.enqueue(bytes(2));
    queue.clear(new Error("closed"));
    await expect(second).rejects.toThrow("closed");
    release();
    await first;
  });
});

describe("SerialOutputStream", () => {
  it("replays retained output to new subscribers and pushes live chunks", () => {
    const stream = new SerialOutputStream();
    stream.append(bytes(1));
    const seen: number[][] = [];
    const off = stream.subscribe({ onChunk: (c) => seen.push(Array.from(c)) });
    stream.append(bytes(2));
    off();
    stream.append(bytes(3));
    expect(seen).toEqual([[1], [2]]);
    expect(stream.subscriberCount).toBe(0);
  });

  it("bounds retained chunks and clears on reset", () => {
    const stream = new SerialOutputStream();
    for (let i = 0; i < 3000; i += 1) stream.append(bytes(i % 256));
    expect(stream.snapshot().length).toBe(2048);
    const onReset = vi.fn();
    stream.subscribe({ onChunk: () => {}, onReset });
    stream.reset();
    expect(onReset).toHaveBeenCalledOnce();
    expect(stream.snapshot()).toHaveLength(0);
  });
});
