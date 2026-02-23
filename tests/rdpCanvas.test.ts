import { describe, it, expect, vi } from 'vitest';
import {
  drawDesktopIcon,
  drawSimulatedDesktop,
  paintFrame,
  decodeBase64Rgba,
  clearCanvas,
} from '../src/components/rdpCanvas';

type MockCtx = Pick<CanvasRenderingContext2D,
  'fillRect' | 'strokeRect' | 'fillText' | 'createLinearGradient' | 'putImageData'> & {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
};

function createMockCtx(): MockCtx {
  const gradient = { addColorStop: vi.fn() } as unknown as CanvasGradient;
  return {
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    putImageData: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: ''
  };
}

describe('rdpCanvas helpers', () => {
  describe('legacy helpers', () => {
    it('drawDesktopIcon uses canvas APIs', () => {
      const ctx = createMockCtx();
      drawDesktopIcon(ctx as unknown as CanvasRenderingContext2D, 10, 20, 'Label');

      expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 48, 48);
      expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 48, 48);
      expect(ctx.fillText).toHaveBeenCalledWith('📁', 34, 52);
    });

    it('drawSimulatedDesktop does not throw', () => {
      const ctx = createMockCtx();
      expect(() => drawSimulatedDesktop(ctx as unknown as CanvasRenderingContext2D, 100, 80)).not.toThrow();
    });
  });

  describe('paintFrame', () => {
    it('puts image data at the correct position', () => {
      const ctx = createMockCtx();
      const rgba = new Uint8ClampedArray(2 * 2 * 4); // 2x2 pixels
      paintFrame(ctx as unknown as CanvasRenderingContext2D, 10, 20, 2, 2, rgba);
      expect(ctx.putImageData).toHaveBeenCalledTimes(1);
      const call = (ctx.putImageData as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(call[1]).toBe(10);
      expect(call[2]).toBe(20);
    });

    it('skips painting with zero dimensions', () => {
      const ctx = createMockCtx();
      paintFrame(ctx as unknown as CanvasRenderingContext2D, 0, 0, 0, 0, new Uint8ClampedArray(0));
      expect(ctx.putImageData).not.toHaveBeenCalled();
    });

    it('skips painting with insufficient data', () => {
      const ctx = createMockCtx();
      const tiny = new Uint8ClampedArray(4); // only 1 pixel, need 4
      paintFrame(ctx as unknown as CanvasRenderingContext2D, 0, 0, 2, 2, tiny);
      expect(ctx.putImageData).not.toHaveBeenCalled();
    });
  });

  describe('decodeBase64Rgba', () => {
    it('decodes base64 to Uint8ClampedArray', () => {
      // btoa('\x00\x01\x02\x03') = 'AAECAw=='
      const result = decodeBase64Rgba('AAECAw==');
      expect(result).toBeInstanceOf(Uint8ClampedArray);
      expect(result.length).toBe(4);
      expect(result[0]).toBe(0);
      expect(result[1]).toBe(1);
      expect(result[2]).toBe(2);
      expect(result[3]).toBe(3);
    });
  });

  describe('clearCanvas', () => {
    it('fills the canvas with dark colour', () => {
      const ctx = createMockCtx();
      clearCanvas(ctx as unknown as CanvasRenderingContext2D, 800, 600);
      expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 800, 600);
      expect(ctx.fillStyle).toBe('#0a0a0a');
    });
  });
});
