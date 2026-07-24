import { describe, expect, it, vi } from "vitest";
import {
  dispatchVncPointerClick,
  mapClientPointToCanvas,
} from "../../src/utils/session/canvasCoordinates";

describe("mapClientPointToCanvas", () => {
  it("maps mismatched landscape content edges and rejects top/bottom letterbox", () => {
    const base = {
      rect: { left: 100, top: 50, width: 1000, height: 1000 },
      canvasWidth: 1920,
      canvasHeight: 1080,
      objectFitContain: true,
    };

    expect(
      mapClientPointToCanvas({ ...base, clientX: 600, clientY: 100 }),
    ).toBeNull();
    expect(
      mapClientPointToCanvas({
        ...base,
        clientX: 100,
        clientY: 268.75,
      }),
    ).toEqual({ x: 0, y: 0 });
    expect(
      mapClientPointToCanvas({
        ...base,
        clientX: 1100,
        clientY: 831.25,
      }),
    ).toEqual({ x: 1919, y: 1079 });
    expect(
      mapClientPointToCanvas({ ...base, clientX: 600, clientY: 900 }),
    ).toBeNull();
  });

  it("maps mismatched portrait content edges and rejects side letterbox", () => {
    const base = {
      rect: { left: 0, top: 0, width: 1600, height: 900 },
      canvasWidth: 900,
      canvasHeight: 1600,
      objectFitContain: true,
    };

    expect(
      mapClientPointToCanvas({ ...base, clientX: 100, clientY: 450 }),
    ).toBeNull();
    expect(
      mapClientPointToCanvas({
        ...base,
        clientX: 546.875,
        clientY: 0,
      }),
    ).toEqual({ x: 0, y: 0 });
    expect(
      mapClientPointToCanvas({
        ...base,
        clientX: 1053.125,
        clientY: 900,
      }),
    ).toEqual({ x: 899, y: 1599 });
    expect(
      mapClientPointToCanvas({ ...base, clientX: 1500, clientY: 450 }),
    ).toBeNull();
  });

  it("uses the full element rect when content is intentionally stretched", () => {
    expect(
      mapClientPointToCanvas({
        clientX: 500,
        clientY: 250,
        rect: { left: 0, top: 0, width: 1000, height: 500 },
        canvasWidth: 1920,
        canvasHeight: 1080,
      }),
    ).toEqual({ x: 960, y: 540 });
  });

  it("rejects empty rectangles and canvas buffers", () => {
    expect(
      mapClientPointToCanvas({
        clientX: 0,
        clientY: 0,
        rect: { left: 0, top: 0, width: 0, height: 100 },
        canvasWidth: 100,
        canvasHeight: 100,
      }),
    ).toBeNull();
  });

  it("dispatches VNC press and release at contained edge coordinates", () => {
    const sendPointerEvent = vi.fn();
    const releases: Array<() => void> = [];
    expect(
      dispatchVncPointerClick({
        clientX: 1100,
        clientY: 831.25,
        rect: { left: 100, top: 50, width: 1000, height: 1000 },
        canvasWidth: 1920,
        canvasHeight: 1080,
        objectFitContain: true,
        sendPointerEvent,
        scheduleRelease: (callback) => releases.push(callback),
      }),
    ).toBe(true);
    expect(sendPointerEvent).toHaveBeenCalledWith(1919, 1079, 0x1);
    expect(sendPointerEvent).toHaveBeenCalledTimes(1);
    releases[0]();
    expect(sendPointerEvent).toHaveBeenLastCalledWith(1919, 1079, 0x0);
  });

  it("does not dispatch VNC press or release for letterbox or zero-sized input", () => {
    const sendPointerEvent = vi.fn();
    const scheduleRelease = vi.fn();
    const base = {
      rect: { left: 0, top: 0, width: 1000, height: 1000 },
      canvasWidth: 1920,
      canvasHeight: 1080,
      objectFitContain: true,
      sendPointerEvent,
      scheduleRelease,
    };

    expect(
      dispatchVncPointerClick({
        ...base,
        clientX: 500,
        clientY: 100,
      }),
    ).toBe(false);
    expect(
      dispatchVncPointerClick({
        ...base,
        clientX: 500,
        clientY: 500,
        canvasWidth: 0,
      }),
    ).toBe(false);
    expect(sendPointerEvent).not.toHaveBeenCalled();
    expect(scheduleRelease).not.toHaveBeenCalled();
  });
});
