import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERIAL_SETTINGS,
  SERIAL_AUTO_HOSTNAME,
  SERIAL_SETTINGS_VERSION,
  hasSerialMatchFilter,
  normalizeSerialPortSelection,
  normalizeSerialSettings,
  serialHostnameFor,
  toNativeSerialConfig,
} from "./serial";

const collectKeys = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap(collectKeys);
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectKeys(nested),
  ]);
};

describe("serial settings contract", () => {
  it("returns stable, truthful defaults for absent and malformed values", () => {
    expect(normalizeSerialSettings(undefined)).toEqual(DEFAULT_SERIAL_SETTINGS);
    expect(normalizeSerialSettings(null)).toEqual(DEFAULT_SERIAL_SETTINGS);
    expect(normalizeSerialSettings("COM3")).toEqual(DEFAULT_SERIAL_SETTINGS);
    expect(normalizeSerialSettings({ version: 99 })).toEqual(
      DEFAULT_SERIAL_SETTINGS,
    );
  });

  it("normalizes legacy aliases, trims the port, and bounds numeric settings", () => {
    expect(
      normalizeSerialSettings({
        device: "  /dev/ttyUSB0  ",
        serialSpeed: "5000000",
        dataBits: 7,
        parity: "even",
        stopBits: 2,
        flowControl: "xonXoff",
        readTimeoutMs: -4,
        writeTimeoutMs: 90_000,
        rxBufferSize: 12,
        txBufferSize: 2_000_000,
        dtrOnOpen: false,
        rtsOnOpen: false,
        lineEnding: "lf",
        charDelayMs: 20_000,
        localEcho: true,
      }),
    ).toEqual({
      version: SERIAL_SETTINGS_VERSION,
      portName: "/dev/ttyUSB0",
      portSelection: { mode: "fixed" },
      baudRate: 4_000_000,
      dataBits: "7",
      parity: "even",
      stopBits: "2",
      flowControl: "xonXoff",
      readTimeoutMs: 0,
      writeTimeoutMs: 60_000,
      rxBufferSize: 256,
      txBufferSize: 1_048_576,
      dtrOnOpen: false,
      rtsOnOpen: false,
      lineEnding: "lf",
      charDelayMs: 10_000,
      localEcho: true,
    });
  });

  it.each([
    [{ parity: "mark" }, "parity", "none"],
    [{ parity: "space" }, "parity", "none"],
    [{ stopBits: "1.5" }, "stopBits", "1"],
    [{ flowControl: "dtrDsr" }, "flowControl", "none"],
  ] as const)(
    "does not advertise unsupported native mode %j",
    (input, field, supportedDefault) => {
      const normalized = normalizeSerialSettings(input);
      expect(normalized[field]).toBe(supportedDefault);
      expect(toNativeSerialConfig(input)[field]).toBe(supportedDefault);
    },
  );

  it("maps standard and custom baud rates to the exact native wire shape", () => {
    expect(
      toNativeSerialConfig(
        {
          portName: "COM7",
          baudRate: 115200,
          dataBits: "8",
          parity: "odd",
          stopBits: "2",
          flowControl: "rtsCts",
          readTimeoutMs: 250,
          writeTimeoutMs: 750,
          rxBufferSize: 8192,
          txBufferSize: 16384,
          dtrOnOpen: false,
          rtsOnOpen: true,
          lineEnding: "cr",
          charDelayMs: 3,
          localEcho: true,
        },
        "  Console cable  ",
      ),
    ).toEqual({
      portName: "COM7",
      portSelection: { mode: "fixed" },
      baudRate: "115200",
      dataBits: "8",
      parity: "odd",
      stopBits: "2",
      flowControl: "rtsCts",
      readTimeoutMs: 250,
      writeTimeoutMs: 750,
      rxBufferSize: 8192,
      txBufferSize: 16384,
      dtrOnOpen: false,
      rtsOnOpen: true,
      lineEnding: "cr",
      label: "Console cable",
      charDelayMs: 3,
      localEcho: true,
    });

    expect(
      toNativeSerialConfig({ portName: "COM8", baudRate: 250000 }),
    ).toMatchObject({
      portName: "COM8",
      baudRate: { Custom: 250000 },
      label: null,
    });
  });

  it("drops credential and secret-shaped input from persisted and native output", () => {
    const untrusted = {
      portName: "COM9",
      username: "admin",
      password: "password",
      token: "token",
      secret: "secret",
      credentialId: "credential",
      privateKey: "private-key",
      passphrase: "passphrase",
      nested: { apiKey: "api-key" },
    };

    for (const output of [
      normalizeSerialSettings(untrusted),
      toNativeSerialConfig(untrusted),
    ]) {
      expect(collectKeys(output)).not.toEqual(
        expect.arrayContaining([
          "username",
          "password",
          "token",
          "secret",
          "credentialId",
          "privateKey",
          "passphrase",
          "apiKey",
        ]),
      );
      expect(collectKeys(output).join(" ")).not.toMatch(
        /credential|password|passphrase|private.?key|secret|token|api.?key/i,
      );
    }
  });

  it("defaults a legacy record without portSelection to the fixed mode", () => {
    const normalized = normalizeSerialSettings({ portName: "COM3" });
    expect(normalized.portSelection).toEqual({ mode: "fixed" });
    expect(normalized.portName).toBe("COM3");
    expect(toNativeSerialConfig({ portName: "COM3" })).toMatchObject({
      portName: "COM3",
      portSelection: { mode: "fixed" },
    });
  });

  it("normalizes auto modes without a port name and blanks the native portName", () => {
    const normalized = normalizeSerialSettings({
      portSelection: { mode: "firstUsb" },
    });
    expect(normalized.portName).toBe("");
    expect(normalized.portSelection).toEqual({ mode: "firstUsb" });
    expect(toNativeSerialConfig(normalized)).toMatchObject({
      portName: "",
      portSelection: { mode: "firstUsb" },
    });

    // Auto modes keep the last typed device so switching back to fixed
    // restores it, but never send it to the backend.
    const kept = normalizeSerialSettings({
      portName: "COM3",
      portSelection: { mode: "firstAny" },
    });
    expect(kept.portName).toBe("COM3");
    expect(toNativeSerialConfig(kept).portName).toBe("");
  });

  it("bounds match filters, strips them for other modes, and rejects unknown modes", () => {
    expect(
      normalizeSerialPortSelection({
        mode: "match",
        vid: 70_000,
        pid: 24577,
        match: "  ftdi  ",
      }),
    ).toEqual({ mode: "match", pid: 24577, match: "ftdi" });
    expect(
      normalizeSerialPortSelection({ mode: "match", vid: 1027, pid: -1 }),
    ).toEqual({ mode: "match", vid: 1027 });
    expect(
      normalizeSerialPortSelection({ mode: "match", vid: "0403", pid: 1.5 }),
    ).toEqual({ mode: "match" });
    expect(
      normalizeSerialPortSelection({ mode: "match", match: "x".repeat(200) })
        .match,
    ).toHaveLength(128);
    expect(
      normalizeSerialPortSelection({ mode: "fixed", vid: 1027, match: "ftdi" }),
    ).toEqual({ mode: "fixed" });
    expect(normalizeSerialPortSelection({ mode: "firstUsb", pid: 1 })).toEqual({
      mode: "firstUsb",
    });
    expect(normalizeSerialPortSelection({ mode: "bogus" })).toEqual({
      mode: "fixed",
    });
    expect(normalizeSerialPortSelection(undefined)).toEqual({ mode: "fixed" });
    expect(normalizeSerialPortSelection("firstUsb")).toEqual({ mode: "fixed" });
  });

  it("reports whether a match selection carries a usable filter", () => {
    expect(hasSerialMatchFilter({ mode: "match" })).toBe(false);
    expect(hasSerialMatchFilter({ mode: "match", vid: 0 })).toBe(true);
    expect(hasSerialMatchFilter({ mode: "match", match: "ftdi" })).toBe(true);
    expect(hasSerialMatchFilter({ mode: "firstUsb" })).toBe(false);
  });

  it("pins the hostname tokens for every selection mode", () => {
    expect(SERIAL_AUTO_HOSTNAME).toEqual({
      firstAny: "auto:first-device",
      firstUsb: "auto:first-usb",
      match: "auto:match",
    });
    expect(
      serialHostnameFor({ portName: "COM3", portSelection: { mode: "fixed" } }),
    ).toBe("COM3");
    expect(
      serialHostnameFor({
        portName: "COM3",
        portSelection: { mode: "firstAny" },
      }),
    ).toBe("auto:first-device");
    expect(
      serialHostnameFor({ portName: "", portSelection: { mode: "firstUsb" } }),
    ).toBe("auto:first-usb");
    expect(
      serialHostnameFor({
        portName: "",
        portSelection: { mode: "match", vid: 1027 },
      }),
    ).toBe("auto:match");
    for (const token of Object.values(SERIAL_AUTO_HOSTNAME)) {
      expect(token).not.toMatch(/\s/);
      expect(token.length).toBeGreaterThan(0);
    }
  });
});
