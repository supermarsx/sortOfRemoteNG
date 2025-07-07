import { describe, it, expect, vi } from 'vitest';
import { drawDesktopIcon, drawSimulatedDesktop } from '../src/components/rdpCanvas';

type MockCtx = Pick<CanvasRenderingContext2D,
  'fillRect' | 'strokeRect' | 'fillText' | 'createLinearGradient'> & {
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
    createLinearGradient: vi.fn(() => gradient),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: ''
  };
}

describe('rdpCanvas helpers', () => {
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
