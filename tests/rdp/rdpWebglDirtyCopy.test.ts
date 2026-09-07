import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps ping-pong textures identical while copying only changed bounds between presentations", async () => {
  type Texture = { pixels: Uint8ClampedArray; width: number };
  type Framebuffer = { texture: Texture };
  const textures: Texture[] = [];
  let boundTexture: Texture;
  let boundFramebuffer: Framebuffer;
  let readFramebuffer: Framebuffer;
  let drawFramebuffer: Framebuffer;
  let displayed = new Uint8ClampedArray();
  const gl = {
    FRAMEBUFFER: 1,
    READ_FRAMEBUFFER: 2,
    DRAW_FRAMEBUFFER: 3,
    COLOR_BUFFER_BIT: 4,
    NEAREST: 5,
    createTexture: () => {
      const texture = { pixels: new Uint8ClampedArray(), width: 0 };
      textures.push(texture);
      return texture;
    },
    bindTexture: (_target: number, texture: Texture) => {
      boundTexture = texture;
    },
    texImage2D: (
      _target: number,
      _level: number,
      _internal: number,
      width: number,
      height: number,
    ) => {
      boundTexture.width = width;
      boundTexture.pixels = new Uint8ClampedArray(width * height * 4);
    },
    texSubImage2D: (
      _target: number,
      _level: number,
      x: number,
      y: number,
      width: number,
      height: number,
      _format: number,
      _type: number,
      pixels: Uint8ClampedArray,
    ) => {
      for (let row = 0; row < height; row++) {
        boundTexture.pixels.set(
          pixels.subarray(row * width * 4, (row + 1) * width * 4),
          ((y + row) * boundTexture.width + x) * 4,
        );
      }
    },
    createFramebuffer: () => ({}),
    bindFramebuffer: (target: number, framebuffer: Framebuffer) => {
      if (target === 1) boundFramebuffer = framebuffer;
      if (target === 2) readFramebuffer = framebuffer;
      if (target === 3) drawFramebuffer = framebuffer;
    },
    framebufferTexture2D: (
      _target: number,
      _attachment: number,
      _textarget: number,
      texture: Texture,
    ) => {
      boundFramebuffer.texture = texture;
    },
    blitFramebuffer: vi.fn(
      (left: number, top: number, right: number, bottom: number) => {
        const source = readFramebuffer.texture;
        const target = drawFramebuffer.texture;
        for (let y = top; y < bottom; y++) {
          target.pixels.set(
            source.pixels.subarray(
              (y * source.width + left) * 4,
              (y * source.width + right) * 4,
            ),
            (y * target.width + left) * 4,
          );
        }
      },
    ),
    drawArrays: vi.fn(() => {
      displayed = boundTexture.pixels.slice();
    }),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getExtension: () => null,
  };
  const context = new Proxy(gl, {
    get: (target, property) =>
      property in target
        ? target[property as keyof typeof target]
        : typeof property === "string" && property.toUpperCase() === property
          ? 0
          : vi.fn(),
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    kind: string,
  ) => (kind.startsWith("webgl") ? context : {})) as never);
  vi.resetModules();
  const { createFrameRenderer } =
    await import("../../src/components/rdp/rdpRenderers");
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const renderer = createFrameRenderer("webgl", canvas, {
    tripleBuffering: true,
  });
  expect(renderer.type).toBe("webgl");
  renderer.paintRegion(0, 0, 8, 8, new Uint8ClampedArray(8 * 8 * 4).fill(1));
  renderer.present();
  renderer.paintRegion(3, 4, 1, 1, new Uint8ClampedArray(4).fill(9));
  renderer.present();
  expect(gl.blitFramebuffer.mock.calls[1]).toEqual([
    3, 4, 4, 5, 3, 4, 4, 5, 4, 5,
  ]);
  expect(textures[0].pixels).toEqual(textures[1].pixels);
  expect(displayed[(4 * 8 + 3) * 4]).toBe(9);
  expect(displayed[0]).toBe(1);
  renderer.paintRegion(2, 3, 1, 1, new Uint8ClampedArray(4).fill(7));
  renderer.paintRegion(4, 5, 1, 1, new Uint8ClampedArray(4).fill(8));
  expect(gl.drawArrays).toHaveBeenCalledTimes(2);
  renderer.present();
  expect(gl.drawArrays).toHaveBeenCalledTimes(3);
  expect(textures[0].pixels).toEqual(textures[1].pixels);
  expect(displayed[(3 * 8 + 2) * 4]).toBe(7);
  expect(displayed[(4 * 8 + 3) * 4]).toBe(9);
  expect(displayed[(5 * 8 + 4) * 4]).toBe(8);
  renderer.present();
  expect(gl.drawArrays).toHaveBeenCalledTimes(3);
  renderer.destroy();
});
