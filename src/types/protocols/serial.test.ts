import { describe, expect, it } from "vitest";
import {
  DEFAULT_SERIAL_SETTINGS,
  SERIAL_SETTINGS_VERSION,
  normalizeSerialSettings,
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
});
