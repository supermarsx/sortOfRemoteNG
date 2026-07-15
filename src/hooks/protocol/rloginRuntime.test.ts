import { describe, expect, it, vi } from "vitest";
import { createDefaultRloginSettings } from "../../utils/rlogin/rloginSettings";
import {
  buildRloginConnectOptions,
  RloginChannelAssembler,
  RloginSequenceCursor,
  type RloginOutputMetadata,
} from "./rloginRuntime";

const metadata = (sequence: number): RloginOutputMetadata => ({
  sessionId: "rlogin-1",
  sequence,
  byteLength: 3,
  prefixTruncated: false,
  replayed: false,
});

describe("RloginChannelAssembler", () => {
  it("delivers arbitrary remote bytes without decoding or interpreting controls", () => {
    const deliver = vi.fn();
    const assembler = new RloginChannelAssembler(deliver);

    assembler.acceptMetadata(metadata(1));
    assembler.acceptData(Uint8Array.of(0x00, 0xff, 0x80));

    expect(deliver).toHaveBeenCalledOnce();
    expect([...deliver.mock.calls[0][0].data]).toEqual([0, 255, 128]);
  });
});

describe("RloginSequenceCursor", () => {
  it("deduplicates live channel output and polled replay", () => {
    const cursor = new RloginSequenceCursor();
    expect(cursor.accept(1)).toBe(true);
    expect(cursor.accept(1)).toBe(false);
    expect(cursor.accept(3)).toBe(true);
    expect(cursor.accept(2)).toBe(false);
    expect(cursor.value).toBe(3);
  });
});

describe("buildRloginConnectOptions", () => {
  it("emits the exact direct, acknowledged, flattened native shape", () => {
    const settings = createDefaultRloginSettings();
    settings.localUsername = "local";
    settings.remoteUsername = "remote";
    settings.plaintextAcknowledgement = {
      version: 1,
      scope: "rlogin-plaintext-v1",
      acknowledged: true,
      acknowledgedAt: "2026-01-01T00:00:00.000Z",
    };
    settings.escapeCharacter = "^]";

    expect(
      buildRloginConnectOptions("connection-1", "host.test", 513, settings),
    ).toMatchObject({
      host: "host.test",
      port: 513,
      localUsername: "local",
      remoteUsername: "remote",
      route: { kind: "direct" },
      sourcePortMode: "ephemeral",
      escapeByte: 0x1d,
      plaintextAcknowledged: true,
      initialWindow: { rows: 24, columns: 80 },
    });
  });

  it("never invents plaintext consent", () => {
    const settings = createDefaultRloginSettings();
    expect(
      buildRloginConnectOptions("connection-1", "host.test", 513, settings)
        .plaintextAcknowledged,
    ).toBe(false);
  });
});
