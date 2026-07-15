import { describe, expect, it, vi } from "vitest";
import { createDefaultRawSocketSettings } from "../../types/protocols/rawSocket";
import {
  buildRawSocketConnectOptions,
  RawSocketChannelAssembler,
  RawSocketSequenceCursor,
  type RawSocketFrameMetadata,
} from "./rawSocketRuntime";

const metadata = (
  sequence: number,
  byteLength: number,
  datagram = false,
): RawSocketFrameMetadata => ({
  sessionId: "raw-1",
  sequence,
  timestampMs: 1_700_000_000_000 + sequence,
  direction: "inbound",
  datagram,
  byteLength,
  replayed: false,
});

describe("RawSocketChannelAssembler", () => {
  it("preserves arbitrary binary TCP chunks without decoding or coalescing", () => {
    const deliver = vi.fn();
    const assembler = new RawSocketChannelAssembler(deliver);
    const bytes = Uint8Array.of(0x00, 0xff, 0x80, 0x0a);

    assembler.acceptData(bytes.buffer);
    assembler.acceptMetadata(metadata(1, bytes.length));

    expect(deliver).toHaveBeenCalledOnce();
    expect([...deliver.mock.calls[0][0].data]).toEqual([0, 255, 128, 10]);
    expect(deliver.mock.calls[0][0]).toMatchObject({
      sequence: 1,
      datagram: false,
      byteLength: 4,
    });
  });

  it("pairs metadata-first events and retains empty UDP datagram boundaries", () => {
    const deliver = vi.fn();
    const assembler = new RawSocketChannelAssembler(deliver);

    assembler.acceptMetadata(metadata(7, 0, true));
    assembler.acceptData(new ArrayBuffer(0));
    assembler.acceptMetadata(metadata(8, 2, true));
    assembler.acceptData(Uint8Array.of(1, 2));

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(deliver.mock.calls.map(([frame]) => frame.sequence)).toEqual([7, 8]);
    expect(deliver.mock.calls.map(([frame]) => frame.data.length)).toEqual([
      0, 2,
    ]);
    expect(deliver.mock.calls.every(([frame]) => frame.datagram)).toBe(true);
  });

  it("clears unpaired channel state on demand", () => {
    const deliver = vi.fn();
    const assembler = new RawSocketChannelAssembler(deliver);
    assembler.acceptData(Uint8Array.of(1));
    assembler.clear();
    assembler.acceptMetadata(metadata(1, 1));

    expect(deliver).not.toHaveBeenCalled();
  });
});

describe("RawSocketSequenceCursor", () => {
  it("deduplicates attach replay and live channel delivery monotonically", () => {
    const cursor = new RawSocketSequenceCursor();

    expect(cursor.accept(1)).toBe(true);
    expect(cursor.accept(1)).toBe(false);
    expect(cursor.accept(0)).toBe(false);
    expect(cursor.accept(3)).toBe(true);
    expect(cursor.accept(2)).toBe(false);
    expect(cursor.value).toBe(3);
  });
});

describe("buildRawSocketConnectOptions", () => {
  it("maps unsupported TLS modes to explicit fail-closed backend routes", () => {
    const settings = createDefaultRawSocketSettings("tcp");
    settings.tls.mode = "direct";

    expect(
      buildRawSocketConnectOptions(
        "connection-1",
        "example.test",
        443,
        settings,
      ).route,
    ).toEqual({ kind: "tls" });

    settings.tls.mode = "starttls_manual";
    expect(
      buildRawSocketConnectOptions("connection-1", "example.test", 23, settings)
        .route,
    ).toEqual({ kind: "start_tls" });
  });

  it("passes bounded transport limits and direct routing exactly", () => {
    const settings = createDefaultRawSocketSettings("udp");
    settings.connection.localBindAddress = "127.0.0.1";
    settings.connection.localBindPort = 4040;
    settings.advanced.maxSendBytes = 1200;

    expect(
      buildRawSocketConnectOptions("connection-2", "127.0.0.1", 9999, settings),
    ).toMatchObject({
      host: "127.0.0.1",
      port: 9999,
      transport: "udp",
      connectionId: "connection-2",
      route: { kind: "direct" },
      localBindAddress: "127.0.0.1",
      localBindPort: 4040,
      limits: { maxSendBytes: 1200 },
    });
  });
});
