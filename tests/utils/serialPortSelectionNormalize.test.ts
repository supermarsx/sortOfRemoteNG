import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { normalizeAdvancedProtocolConnection } from "../../src/utils/connection/normalizeAdvancedProtocolConnection";

const base = {
  id: "serial-1",
  name: "Console",
  protocol: "serial",
  port: 22,
  password: "should-be-dropped",
} as unknown as Connection;

describe("normalizeAdvancedProtocolConnection serial port selection", () => {
  it("keeps a legacy fixed record mirroring the device path into hostname", () => {
    const next = normalizeAdvancedProtocolConnection({
      ...base,
      hostname: "COM3",
    });
    expect(next.serialSettings?.portSelection).toEqual({ mode: "fixed" });
    expect(next.serialSettings?.portName).toBe("COM3");
    expect(next.hostname).toBe("COM3");
    expect(next.port).toBe(0);
    expect(next.password).toBeUndefined();
  });

  it("mirrors the auto hostname token for firstUsb without a port name", () => {
    const next = normalizeAdvancedProtocolConnection({
      ...base,
      hostname: "",
      serialSettings: { portSelection: { mode: "firstUsb" } } as never,
    });
    expect(next.serialSettings?.portSelection).toEqual({ mode: "firstUsb" });
    expect(next.serialSettings?.portName).toBe("");
    expect(next.hostname).toBe("auto:first-usb");
    expect(next.port).toBe(0);
  });

  it.each([
    ["firstAny", "auto:first-device"],
    ["match", "auto:match"],
  ])("mirrors %s to %s and overrides a stale hostname", (mode, token) => {
    const next = normalizeAdvancedProtocolConnection({
      ...base,
      hostname: "COM9",
      serialSettings: {
        portName: "COM9",
        portSelection: { mode, vid: 1027 },
      } as never,
    });
    expect(next.hostname).toBe(token);
    // The typed device is retained for a later switch back to fixed.
    expect(next.serialSettings?.portName).toBe("COM9");
  });

  it("preserves a match selection across a round trip and is idempotent", () => {
    const first = normalizeAdvancedProtocolConnection({
      ...base,
      hostname: "",
      serialSettings: {
        portSelection: { mode: "match", vid: 1027, pid: 24577, match: "FTDI" },
      } as never,
    });
    expect(first.serialSettings?.portSelection).toEqual({
      mode: "match",
      vid: 1027,
      pid: 24577,
      match: "FTDI",
    });
    const second = normalizeAdvancedProtocolConnection(first as Connection);
    expect(second).toEqual(first);
  });

  it("honours the legacy device alias while defaulting the selection", () => {
    const next = normalizeAdvancedProtocolConnection({
      ...base,
      hostname: "",
      serialSettings: { device: "/dev/ttyUSB0" } as never,
    });
    expect(next.serialSettings?.portName).toBe("/dev/ttyUSB0");
    expect(next.serialSettings?.portSelection).toEqual({ mode: "fixed" });
    expect(next.hostname).toBe("/dev/ttyUSB0");
  });
});
