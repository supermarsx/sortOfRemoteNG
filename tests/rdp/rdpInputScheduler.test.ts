import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RdpInputBackpressureError,
  RdpInputScheduler,
} from "../../src/utils/rdp/rdpInputScheduler";

const move = (x: number) => ({ type: "MouseMove", x, y: 1 });
const button = (pressed: boolean) => ({
  type: "MouseButton",
  button: 0,
  pressed,
  x: 1,
  y: 1,
});

afterEach(() => vi.useRealTimers());

describe("RDP input scheduling", () => {
  it("bounds a stalled control queue, pauses input and sends only corrective releases after completion", async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const sender = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const scheduler = new RdpInputScheduler(sender, onError);
    scheduler.setSession("one");
    const pressed = [
      button(true),
      { type: "KeyboardKey", scancode: 3, extended: false, pressed: true },
      { type: "Unicode", code: 32, pressed: true },
    ];
    scheduler.enqueue(pressed, true);
    for (let index = 0; index < 2000; index++)
      scheduler.enqueue([{ type: "Wheel", delta: 120, x: 1, y: 1 }], true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(RdpInputBackpressureError);
    expect(sender).toHaveBeenCalledTimes(1);
    complete();
    await vi.advanceTimersByTimeAsync(0);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1]).toEqual([
      "one",
      pressed.map((event) => ({ ...event, pressed: false })),
    ]);
    scheduler.enqueue([move(4), button(true)], true);
    await vi.advanceTimersByTimeAsync(100);
    expect(sender).toHaveBeenCalledTimes(2);
    scheduler.setSession("reconnected");
    scheduler.enqueue([button(true)], true);
    expect(sender).toHaveBeenLastCalledWith("reconnected", [button(true)]);
  });

  it("times out once after ten seconds and never lets a stale completion release a new session", async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const sender = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const scheduler = new RdpInputScheduler(sender, onError);
    scheduler.setSession("old");
    scheduler.enqueue([button(true)], true);
    await vi.advanceTimersByTimeAsync(9999);
    expect(onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onError).toHaveBeenCalledTimes(1);
    scheduler.setSession("new");
    complete();
    await vi.advanceTimersByTimeAsync(0);
    expect(sender).toHaveBeenCalledTimes(1);
    scheduler.enqueue([button(false)], true);
    expect(sender).toHaveBeenLastCalledWith("new", [button(false)]);
  });

  it("enforces the byte bound before sending an oversized control payload", () => {
    vi.useFakeTimers();
    const sender = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const scheduler = new RdpInputScheduler(sender, onError);
    scheduler.setSession("one");
    scheduler.enqueue([
      {
        type: "KeyboardKey",
        scancode: 1,
        pressed: true,
        extra: "x".repeat(65536),
      },
    ]);
    expect(sender).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toBeInstanceOf(RdpInputBackpressureError);
  });

  it("coalesces mouse events from distinct browser tasks and stays idle without input", async () => {
    vi.useFakeTimers();
    const sender = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RdpInputScheduler(sender);
    scheduler.setSession("one");
    for (let x = 0; x < 8; x++) {
      scheduler.enqueue([move(x)]);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(sender).toHaveBeenCalledExactlyOnceWith("one", [move(7)]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds in-flight calls and sends ordered controls and release as soon as credit returns", async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    const sender = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    const scheduler = new RdpInputScheduler(sender);
    scheduler.setSession("one");
    scheduler.enqueue([button(true)], true);
    for (let x = 0; x < 1000; x++) {
      scheduler.enqueue([move(x)]);
      await vi.advanceTimersByTimeAsync(1);
    }
    scheduler.enqueue(
      [{ type: "KeyboardKey", scancode: 1, pressed: true }],
      true,
    );
    scheduler.enqueue([move(1000)]);
    scheduler.enqueue([button(false)], true);
    expect(sender).toHaveBeenCalledTimes(1);
    complete();
    await vi.advanceTimersByTimeAsync(0);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1][1]).toEqual([
      move(999),
      { type: "KeyboardKey", scancode: 1, pressed: true },
      move(1000),
      button(false),
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes pending motion before wheel/button events without a cadence delay", async () => {
    vi.useFakeTimers();
    const sender = vi.fn().mockResolvedValue(undefined);
    const scheduler = new RdpInputScheduler(sender);
    scheduler.setSession("one");
    scheduler.enqueue([move(4)]);
    const wheel = { type: "Wheel", delta: 120, x: 4, y: 1 };
    scheduler.enqueue([wheel], true);
    expect(sender).toHaveBeenCalledExactlyOnceWith("one", [move(4), wheel]);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears stale motion on session replacement and recovers from rejected sends", async () => {
    vi.useFakeTimers();
    const failure = new Error("closed");
    const sender = vi
      .fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const scheduler = new RdpInputScheduler(sender, onError);
    scheduler.setSession("old");
    scheduler.enqueue([move(2)]);
    scheduler.setSession("new");
    scheduler.enqueue([button(true)], true);
    scheduler.enqueue([button(false)], true);
    await vi.advanceTimersByTimeAsync(10);
    expect(sender.mock.calls).toEqual([
      ["new", [button(true)]],
      ["new", [button(false)]],
    ]);
    expect(onError).toHaveBeenCalledWith(failure);
  });
});
