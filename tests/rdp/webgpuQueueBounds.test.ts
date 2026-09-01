import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFrameRenderer } from "../../src/components/rdp/rdpRenderers";

type PendingWebGpuRenderer = ReturnType<typeof createFrameRenderer> & {
  pendingPaints: Array<{ rgba: Uint8Array }>;
  pendingPaintBytes: number;
  fallback: unknown;
};

describe("WebGPU pre-initialization queue bounds", () => {
  const originalGpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  const originalImageData = globalThis.ImageData;

  beforeEach(() => {
    vi.useFakeTimers();

    Object.defineProperty(globalThis, "ImageData", {
      configurable: true,
      writable: true,
      value: class ImageDataMock {
        readonly data: Uint8ClampedArray;
        readonly width: number;
        readonly height: number;

        constructor(width: number, height: number) {
          this.width = width;
          this.height = height;
          this.data = new Uint8ClampedArray(width * height * 4);
        }
      },
    });

    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter: vi.fn(() => new Promise(() => {})),
        getPreferredCanvasFormat: vi.fn(() => "rgba8unorm"),
      },
    });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
      kind: string,
    ) => {
      if (kind === "2d") {
        return {
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          putImageData: vi.fn(),
          imageSmoothingEnabled: false,
          imageSmoothingQuality: "high",
        } as unknown as CanvasRenderingContext2D;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();

    if (originalGpu === undefined) {
      Reflect.deleteProperty(navigator, "gpu");
    } else {
      Object.defineProperty(navigator, "gpu", {
        configurable: true,
        value: originalGpu,
      });
    }

    if (originalImageData === undefined) {
      Reflect.deleteProperty(globalThis, "ImageData");
    } else {
      Object.defineProperty(globalThis, "ImageData", {
        configurable: true,
        writable: true,
        value: originalImageData,
      });
    }
  });

  it("falls back instead of retaining an unbounded paint count", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const warnings: Array<{ reason: string; message: string }> = [];
    window.addEventListener(
      "rdp:webgpu-fallback",
      ((event: CustomEvent<{ reason: string; message: string }>) => {
        warnings.push(event.detail);
      }) as EventListener,
      { once: true },
    );

    const renderer = createFrameRenderer(
      "webgpu",
      canvas,
    ) as PendingWebGpuRenderer;
    const paint = new Uint8ClampedArray(4 * 4 * 4).fill(0x7f);
    for (let index = 0; index < 1_000; index += 1) {
      renderer.paintRegion(0, 0, 4, 4, paint);
    }

    expect(renderer.pendingPaints).toHaveLength(0);
    expect(renderer.pendingPaintBytes).toBe(0);
    expect(renderer.fallback).not.toBeNull();
    expect(warnings.map((warning) => warning.reason)).toEqual([
      "queue-overflow",
    ]);
    renderer.destroy();
    errorSpy.mockRestore();
  });

  it("falls back before copied paint bytes exceed the retained-work cap", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 1024;
    const warnings: Array<{ reason: string; message: string }> = [];
    window.addEventListener(
      "rdp:webgpu-fallback",
      ((event: CustomEvent<{ reason: string; message: string }>) => {
        warnings.push(event.detail);
      }) as EventListener,
      { once: true },
    );

    const renderer = createFrameRenderer(
      "webgpu",
      canvas,
    ) as PendingWebGpuRenderer;
    const fullPaint = new Uint8ClampedArray(1280 * 1024 * 4).fill(0x7f);
    for (let index = 0; index < 3; index += 1) {
      renderer.paintRegion(0, 0, 1280, 1024, fullPaint);
    }

    expect(renderer.pendingPaints).toHaveLength(3);
    expect(renderer.pendingPaintBytes).toBe(15 * 1024 * 1024);
    renderer.paintRegion(0, 0, 1280, 1024, fullPaint);

    expect(renderer.pendingPaints).toHaveLength(0);
    expect(renderer.pendingPaintBytes).toBe(0);
    expect(renderer.fallback).not.toBeNull();
    expect(warnings.map((warning) => warning.reason)).toEqual([
      "queue-overflow",
    ]);
    renderer.destroy();
    errorSpy.mockRestore();
  });

  it("destroys a device acquired after timeout fallback and renderer teardown", async () => {
    let resolveDevice!: (device: GPUDevice) => void;
    const destroyDevice = vi.fn();
    const requestDevice = vi.fn(
      () =>
        new Promise<GPUDevice>((resolve) => {
          resolveDevice = resolve;
        }),
    );
    Object.defineProperty(navigator, "gpu", {
      configurable: true,
      value: {
        requestAdapter: vi.fn(async () => ({ requestDevice })),
        getPreferredCanvasFormat: vi.fn(() => "rgba8unorm"),
      },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;

    const renderer = createFrameRenderer("webgpu", canvas);
    await Promise.resolve();
    await Promise.resolve();
    expect(requestDevice).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    renderer.destroy();
    resolveDevice({ destroy: destroyDevice } as unknown as GPUDevice);
    await Promise.resolve();
    await Promise.resolve();

    expect(destroyDevice).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
