// These parsers are self-contained because their compiled source is also used
// by the inline rendering worker. Keep wire bounds identical in both contexts.
export const NAL_V2_MAGIC = 0x324c414e;
export const RGBA_V2_MAGIC = 0x32424752;

export function parseRdpRgbaEnvelope(data: ArrayBuffer | ArrayBufferView) {
  const view =
    data instanceof ArrayBuffer
      ? new DataView(data)
      : new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.byteLength < 4 || view.getUint32(0, true) !== 0x32424752) {
    return {
      offset: 0,
      frameId: null as number | null,
      begin: false,
      end: true,
    };
  }
  if (view.byteLength < 20) throw new Error("Truncated RGBA2 frame");
  const flags = view.getUint16(8, true);
  if ((flags & ~3) !== 0 || view.getUint16(10, true) !== 0) {
    throw new Error("Invalid RGBA2 flags");
  }
  return {
    offset: 12,
    frameId: view.getUint32(4, true),
    begin: (flags & 1) !== 0,
    end: (flags & 2) !== 0,
  };
}

export function parseRdpNalEnvelope(
  data: ArrayBuffer | ArrayBufferView,
  validateRegions = true,
) {
  const view =
    data instanceof ArrayBuffer
      ? new DataView(data)
      : new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.byteLength < 16) throw new Error("Truncated NAL frame");
  const magic = view.getUint32(0, true);
  if (magic === 0x4e414c48) {
    const width = view.getUint16(10, true);
    const height = view.getUint16(12, true);
    return {
      surfaceId: view.getUint16(4, true),
      x: view.getUint16(6, true),
      y: view.getUint16(8, true),
      width,
      height,
      codedWidth: width,
      codedHeight: height,
      offset: 16,
      regionCount: 1,
      regionData: null as DataView | null,
    };
  }
  if (
    magic !== 0x324c414e ||
    view.byteLength < 28 ||
    view.getUint16(18, true) !== 0
  )
    throw new Error("Invalid NAL2 header");
  const width = view.getUint16(10, true);
  const height = view.getUint16(12, true);
  const codedWidth = view.getUint16(14, true);
  const codedHeight = view.getUint16(16, true);
  const count = view.getUint32(20, true);
  const length = view.getUint32(24, true);
  const offset = 28 + count * 8;
  if (
    !width ||
    !height ||
    (codedWidth === 0) !== (codedHeight === 0) ||
    count > 262144 ||
    length === 0 ||
    offset + length !== view.byteLength
  )
    throw new Error("Invalid NAL2 bounds");
  for (let index = 0; validateRegions && index < count; index++) {
    const at = 28 + index * 8;
    const left = view.getUint16(at, true);
    const top = view.getUint16(at + 2, true);
    const right = view.getUint16(at + 4, true);
    const bottom = view.getUint16(at + 6, true);
    if (left >= right || top >= bottom || right > width || bottom > height) {
      throw new Error("Invalid NAL2 region");
    }
  }
  return {
    surfaceId: view.getUint16(4, true),
    x: view.getUint16(6, true),
    y: view.getUint16(8, true),
    width,
    height,
    codedWidth,
    codedHeight,
    offset,
    regionCount: count,
    regionData: new DataView(view.buffer, view.byteOffset + 28, count * 8),
  };
}
