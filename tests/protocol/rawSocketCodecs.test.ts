import { describe, expect, it } from "vitest";
import {
  RawSocketCodecError,
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  bytesToText,
  decodeRawSocketPayload,
  encodeRawSocketPayload,
  hexToBytes,
  textToBytes,
} from "../../src/utils/protocols/rawSocket/codecs";

describe("raw socket codecs", () => {
  it("round-trips UTF-8 including nulls and non-BMP characters", () => {
    const value = "hello\0 — café — 🛰️";
    expect(bytesToText(textToBytes(value), { fatal: true })).toBe(value);
    expect(() =>
      bytesToText(Uint8Array.of(0xff), { fatal: true }),
    ).toThrowError(expect.objectContaining({ code: "invalid_utf8" }));
  });

  it("parses readable hex forms and rejects partial or invalid bytes", () => {
    expect(Array.from(hexToBytes("0x00 ff:10-7F"))).toEqual([0, 255, 16, 127]);
    expect(bytesToHex(Uint8Array.of(0, 255, 16), { uppercase: true })).toBe(
      "00 FF 10",
    );
    for (const invalid of ["f", "fg", "10x2", "0x"]) {
      expect(() => hexToBytes(invalid)).toThrow(RawSocketCodecError);
    }
  });

  it.each([
    [new Uint8Array(), ""],
    [Uint8Array.of(0x66), "Zg=="],
    [Uint8Array.of(0x66, 0x6f), "Zm8="],
    [Uint8Array.of(0x66, 0x6f, 0x6f), "Zm9v"],
    [Uint8Array.of(0xfb, 0xff), "+/8="],
  ])("matches standard Base64 vectors", (bytes, encoded) => {
    expect(bytesToBase64(bytes)).toBe(encoded);
    expect(base64ToBytes(encoded)).toEqual(bytes);
  });

  it("accepts unpadded and URL-safe Base64 while rejecting malformed padding", () => {
    expect(Array.from(base64ToBytes("-_8"))).toEqual([251, 255]);
    expect(Array.from(base64ToBytes(" Zm8 \n"))).toEqual([102, 111]);
    for (const invalid of ["A", "ab=c", "Z===", "Zh=="]) {
      expect(() => base64ToBytes(invalid)).toThrowError(
        expect.objectContaining({ code: "invalid_base64" }),
      );
    }
  });

  it("property-round-trips deterministic binary payloads through hex and Base64", () => {
    for (let length = 0; length <= 257; length++) {
      const bytes = Uint8Array.from(
        { length },
        (_, index) => (index * 73 + length * 19) & 0xff,
      );
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
      expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
    }
  });

  it("appends line-ending bytes after decoding every composer format", () => {
    expect(
      Array.from(encodeRawSocketPayload("ff", "hex", { lineEnding: "crlf" })),
    ).toEqual([0xff, 0x0d, 0x0a]);
    expect(
      Array.from(
        encodeRawSocketPayload("/w==", "base64", { lineEnding: "lf" }),
      ),
    ).toEqual([0xff, 0x0a]);
    expect(
      Array.from(encodeRawSocketPayload("ok", "text", { lineEnding: "lf" })),
    ).toEqual([0x6f, 0x6b, 0x0a]);
  });

  it("decodes transcript payloads without lossy binary coercion", () => {
    const bytes = Uint8Array.of(0, 0xff, 0x10);
    expect(decodeRawSocketPayload(bytes, "hex")).toBe("00 ff 10");
    expect(decodeRawSocketPayload(bytes, "base64")).toBe("AP8Q");
  });

  it("enforces byte limits before returning decoded payloads", () => {
    expect(() => textToBytes("four", 3)).toThrowError(
      expect.objectContaining({ code: "payload_too_large" }),
    );
    expect(() => base64ToBytes("Zm9v", 2)).toThrowError(
      expect.objectContaining({ code: "payload_too_large" }),
    );
    expect(() =>
      encodeRawSocketPayload("ff", "hex", { lineEnding: "lf", maxBytes: 1 }),
    ).toThrowError(expect.objectContaining({ code: "payload_too_large" }));
  });
});
