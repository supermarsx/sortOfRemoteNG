/**
 * Maximum payload the frontend RDP queue can retain for a single frame.
 * Keep this aligned with the queue byte ceiling in `RdpFramePipeline`.
 */
export const MAX_RDP_FRAME_PAYLOAD_BYTES = 32 * 1024 * 1024;

export type RdpFramePayloadErrorCode =
  "invalid-byte" | "oversized" | "unsupported";

export class RdpFramePayloadError extends Error {
  constructor(
    readonly code: RdpFramePayloadErrorCode,
    message: string,
    readonly observedByteLength = 0,
  ) {
    super(message);
    this.name = "RdpFramePayloadError";
  }
}

const objectTag = (value: unknown): string =>
  Object.prototype.toString.call(value);

const isLocalArrayBuffer = (value: unknown): value is ArrayBuffer =>
  value instanceof ArrayBuffer;

const isSharedArrayBuffer = (value: unknown): value is SharedArrayBuffer =>
  typeof SharedArrayBuffer !== "undefined" &&
  (value instanceof SharedArrayBuffer ||
    objectTag(value) === "[object SharedArrayBuffer]");

function copyByteWindow(
  buffer: ArrayBufferLike,
  byteOffset: number,
  byteLength: number,
): ArrayBuffer {
  const copy = new Uint8Array(byteLength);
  copy.set(new Uint8Array(buffer, byteOffset, byteLength));
  return copy.buffer;
}

/**
 * Normalize the payload shape produced by Tauri's raw IPC channel.
 *
 * Tauri normally resolves `InvokeResponseBody::Raw` as an `ArrayBuffer`.
 * When its custom-protocol transport falls back to the postMessage path,
 * however, the same `Vec<u8>` is JSON-serialized as a plain number array.
 * Typed-array views are also accepted because embedders and tests may retain
 * that representation.
 *
 * The returned buffer is safe for transfer to the WebCodecs worker:
 *
 * - Local ArrayBuffers and full, transferable views keep their ownership.
 * - Foreign-realm ArrayBuffers are copied into this realm before downstream
 *   renderer checks; returning them unchanged makes `instanceof ArrayBuffer`
 *   fail and can send `undefined` into the DataView constructor.
 * - Offset views are copied so transferring the frame cannot detach unrelated
 *   bytes from a larger backing allocation.
 * - Shared buffers are copied because they cannot appear in a transfer list.
 * - Serialized byte arrays require one validated copy by definition.
 */
export function normalizeRdpFramePayload(
  payload: unknown,
  maxCopiedBytes = MAX_RDP_FRAME_PAYLOAD_BYTES,
): ArrayBuffer {
  if (isLocalArrayBuffer(payload)) return payload;

  if (objectTag(payload) === "[object ArrayBuffer]") {
    // The tag check intentionally accepts ArrayBuffers from another realm.
    // Keep a local binding because `instanceof` cannot express that shape to
    // TypeScript's control-flow analysis.
    const foreignBuffer = payload as ArrayBuffer;
    if (foreignBuffer.byteLength > maxCopiedBytes) {
      throw new RdpFramePayloadError(
        "oversized",
        `foreign frame payload is ${foreignBuffer.byteLength} bytes (maximum ${maxCopiedBytes})`,
        foreignBuffer.byteLength,
      );
    }
    return copyByteWindow(foreignBuffer, 0, foreignBuffer.byteLength);
  }

  if (isSharedArrayBuffer(payload)) {
    if (payload.byteLength > maxCopiedBytes) {
      throw new RdpFramePayloadError(
        "oversized",
        `shared frame payload is ${payload.byteLength} bytes (maximum ${maxCopiedBytes})`,
        payload.byteLength,
      );
    }
    return copyByteWindow(payload, 0, payload.byteLength);
  }

  if (ArrayBuffer.isView(payload)) {
    const { buffer, byteOffset, byteLength } = payload;
    if (byteLength > maxCopiedBytes) {
      throw new RdpFramePayloadError(
        "oversized",
        `frame view is ${byteLength} bytes (maximum ${maxCopiedBytes})`,
        byteLength,
      );
    }

    if (
      isLocalArrayBuffer(buffer) &&
      byteOffset === 0 &&
      byteLength === buffer.byteLength
    ) {
      return buffer;
    }
    return copyByteWindow(buffer, byteOffset, byteLength);
  }

  if (Array.isArray(payload)) {
    if (payload.length > maxCopiedBytes) {
      throw new RdpFramePayloadError(
        "oversized",
        `serialized frame payload is ${payload.length} bytes (maximum ${maxCopiedBytes})`,
        payload.length,
      );
    }

    const bytes = new Uint8Array(payload.length);
    for (let index = 0; index < payload.length; index += 1) {
      const value = payload[index];
      if (!Number.isInteger(value) || value < 0 || value > 0xff) {
        throw new RdpFramePayloadError(
          "invalid-byte",
          `serialized frame payload contains an invalid byte at index ${index}`,
          payload.length,
        );
      }
      bytes[index] = value;
    }
    return bytes.buffer;
  }

  throw new RdpFramePayloadError(
    "unsupported",
    `unsupported frame payload type ${objectTag(payload)}`,
  );
}
