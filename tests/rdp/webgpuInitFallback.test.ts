import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameRenderer } from '../../src/components/rdp/rdpRenderers';

describe('WebGPU init fallback', () => {
  const originalGpu = (navigator as Navigator & { gpu?: unknown }).gpu;
  const originalImageData = globalThis.ImageData;

  beforeEach(() => {
    vi.useFakeTimers();

    Object.defineProperty(globalThis, 'ImageData', {
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

    Object.defineProperty(navigator, 'gpu', {
      configurable: true,
      value: {
        requestAdapter: vi.fn(() => new Promise(() => {})),
        getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm'),
      },
    });

    const getContextMock = (function getContext(kind: string) {
      if (kind === '2d') {
        return {
          clearRect: vi.fn(),
          drawImage: vi.fn(),
          putImageData: vi.fn(),
          imageSmoothingEnabled: false,
          imageSmoothingQuality: 'high',
        } as unknown as CanvasRenderingContext2D;
      }

      if (kind === 'webgpu') {
        return {
          configure: vi.fn(),
          unconfigure: vi.fn(),
          getCurrentTexture: vi.fn(),
        } as unknown as GPUCanvasContext;
      }

      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(getContextMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();

    if (originalGpu === undefined) {
      Reflect.deleteProperty(navigator, 'gpu');
    } else {
      Object.defineProperty(navigator, 'gpu', {
        configurable: true,
        value: originalGpu,
      });
    }

    if (originalImageData === undefined) {
      Reflect.deleteProperty(globalThis, 'ImageData');
    } else {
      Object.defineProperty(globalThis, 'ImageData', {
        configurable: true,
        writable: true,
        value: originalImageData,
      });
    }
  });

  it('emits a fallback warning when WebGPU init hangs past the timeout', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;

    const warnings: Array<{ reason: string; message: string }> = [];
    window.addEventListener('rdp:webgpu-fallback', ((event: CustomEvent<{ reason: string; message: string }>) => {
      warnings.push(event.detail);
    }) as EventListener, { once: true });

    const renderer = createFrameRenderer('webgpu', canvas);

    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();

    renderer.paintRegion(0, 0, 1, 1, new Uint8ClampedArray([255, 0, 0, 255]));
    renderer.present();

    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.reason).toBe('timeout');
  });
});