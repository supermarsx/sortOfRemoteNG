import { describe, expect, it, vi } from "vitest";
import type { Connection } from "../../types/connection/connection";
import type { ArdFrameMetadata } from "../../types/protocols/ard";
import {
  ArdFrameAssembler,
  ardKeysymForKey,
  ardUnsupportedNetworkPath,
} from "./ardRuntime";

const metadata: ArdFrameMetadata = {
  sessionId: "ard-1",
  sequence: 1,
  x: 2,
  y: 3,
  width: 1,
  height: 1,
  byteLength: 4,
  kind: { type: "framebuffer" },
};

describe("ArdFrameAssembler", () => {
  it("pairs binary data and metadata regardless of arrival order", () => {
    const deliver = vi.fn();
    const assembler = new ArdFrameAssembler(deliver);

    assembler.acceptMetadata(metadata);
    assembler.acceptData(Uint8Array.from([1, 2, 3, 4]));

    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver.mock.calls[0]?.[0]).toEqual({
      metadata,
      data: Uint8Array.from([1, 2, 3, 4]),
    });
  });
});

describe("ARD runtime boundaries", () => {
  it("rejects configured proxy and tunnel routes instead of ignoring them", () => {
    const direct = { security: {} } as Connection;
    const proxied = { proxyChainId: "chain-1" } as Connection;
    expect(ardUnsupportedNetworkPath(direct)).toBeNull();
    expect(ardUnsupportedNetworkPath(proxied)).toContain("direct TCP");
  });

  it("maps browser keys to RFB/X11 keysyms", () => {
    expect(ardKeysymForKey("a")).toBe(0x61);
    expect(ardKeysymForKey("ArrowLeft")).toBe(0xff51);
    expect(ardKeysymForKey("F12")).toBe(0xffc9);
    expect(ardKeysymForKey("🙂")).toBe(0x0100_0000 + 0x1f642);
    expect(ardKeysymForKey("Dead")).toBeNull();
  });
});
