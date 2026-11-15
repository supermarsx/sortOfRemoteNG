import { describe, expect, it } from "vitest";
import { deriveQuickConnectTarget } from "../../src/hooks/connection/useQuickConnect";
import {
  looksLikeQuickConnectSerial,
  parseQuickConnectSerial,
} from "../../src/utils/connection/quickConnectSerial";
import { createQuickConnectConnection } from "../../src/utils/session/quickConnectConnection";

describe("parseQuickConnectSerial", () => {
  const valid: Array<[string, string, Record<string, unknown>]> = [
    ["COM3", "COM3", { baudRate: 9600 }],
    ["com3", "COM3", { baudRate: 9600 }],
    ["COM3:115200", "COM3", { baudRate: 115200 }],
    [
      "COM3:57600,7E2",
      "COM3",
      { baudRate: 57600, dataBits: "7", parity: "even", stopBits: "2" },
    ],
    ["\\\\.\\COM12", "COM12", { baudRate: 9600 }],
    ["\\\\.\\COM12:19200", "COM12", { baudRate: 19200 }],
    ["COM256", "COM256", {}],
    ["/dev/ttyUSB0", "/dev/ttyUSB0", {}],
    ["/dev/ttyACM0:115200", "/dev/ttyACM0", { baudRate: 115200 }],
    ["/dev/cu.usbserial-1410", "/dev/cu.usbserial-1410", {}],
    ["/dev/tty.usbmodem1101", "/dev/tty.usbmodem1101", {}],
    [
      "serial://COM3?baud=115200&data=7&parity=odd&stop=2&flow=rtscts",
      "COM3",
      {
        baudRate: 115200,
        dataBits: "7",
        parity: "odd",
        stopBits: "2",
        flowControl: "rtsCts",
      },
    ],
    ["SERIAL://COM4?baud=9600", "COM4", { baudRate: 9600 }],
    [
      "serial:///dev/ttyUSB0?baud=38400&flow=xonxoff",
      "/dev/ttyUSB0",
      { baudRate: 38400, flowControl: "xonXoff" },
    ],
    ["serial://COM5:115200", "COM5", { baudRate: 115200 }],
  ];

  it.each(valid)("accepts %s", (input, port, expected) => {
    const target = parseQuickConnectSerial(input);
    expect(target.portName).toBe(port);
    expect(target.hostname).toBe(port);
    expect(target.settings.portSelection.mode).toBe("fixed");
    expect(target.settings).toMatchObject(expected);
  });

  const invalid = [
    "",
    "   ",
    "COM0",
    "COM257",
    "COM",
    "COM3x",
    "COM03",
    "COM3:",
    "COM3:abc",
    "COM3:299",
    "COM3:4000001",
    "COM3:9600,9N1",
    "COM3:9600,8N1,extra",
    "COM3?baud=9600",
    "/dev/sda",
    "/dev/null",
    "/dev/tty",
    "/dev/ttyUSB0/../sda",
    "/dev/tty..",
    "/dev/../etc/passwd",
    "/etc/passwd",
    "/dev/ttyUSB0\u0000",
    "COM3\r\nCOM4",
    "COM3 COM4",
    "user@COM3",
    "COM3#frag",
    "/dev/ttyUSB%2e0",
    "serial://",
    "serial://COM3?",
    "serial://COM3?baud",
    "serial://COM3?baud=",
    "serial://COM3?baud=9600&baud=19200",
    "serial://COM3?baud=9600&evil=1",
    "serial://COM3?data=9",
    "serial://COM3?parity=mark",
    "serial://COM3?stop=3",
    "serial://COM3?flow=dtrdsr",
    "serial://COM3:9600?baud=9600",
    "serial://example.com",
    "serial:///etc/shadow",
    "\\\\server\\share",
    "\\\\.\\PhysicalDrive0",
    "\\\\.\\COM3\\x",
    `COM3${"1".repeat(300)}`,
  ];

  it.each(invalid)("rejects %j", (input) => {
    expect(() => parseQuickConnectSerial(input)).toThrow();
  });
});

describe("looksLikeQuickConnectSerial", () => {
  it.each([
    "COM3",
    "com12:9600",
    "\\\\.\\COM12",
    "/dev/ttyUSB0",
    "/dev/cu.usbserial-1",
    "serial://COM3?baud=9600",
  ])("detects %s", (input) => {
    expect(looksLikeQuickConnectSerial(input)).toBe(true);
  });

  it.each([
    "",
    "192.168.1.1",
    "host:22",
    "comfy.example.com",
    "com3.example.com",
    "https://x",
    "/dev/sda",
  ])("does not detect %s", (input) => {
    expect(looksLikeQuickConnectSerial(input)).toBe(false);
  });
});

describe("deriveQuickConnectTarget with serial", () => {
  it("switches the picker for a bare COM port", () => {
    expect(deriveQuickConnectTarget("COM3", "https")).toEqual({
      hostname: "COM3",
      protocol: "serial",
    });
  });

  it("keeps the full serial:// query text", () => {
    expect(
      deriveQuickConnectTarget("serial://COM3?baud=9600&flow=none", "ssh"),
    ).toEqual({
      hostname: "serial://COM3?baud=9600&flow=none",
      protocol: "serial",
    });
  });

  it("does nothing when already serial and clean", () => {
    expect(deriveQuickConnectTarget("COM3:115200", "serial")).toBeUndefined();
  });

  it("leaves ordinary hosts alone", () => {
    expect(deriveQuickConnectTarget("example.com", "ssh")).toBeUndefined();
  });
});

describe("createQuickConnectConnection serial", () => {
  it("builds a credential-free serial runtime connection", () => {
    const connection = createQuickConnectConnection(
      {
        hostname: "COM3:115200",
        protocol: "serial",
        username: "root",
        password: "secret",
      },
      "Quick Connect",
    );
    expect(connection).toMatchObject({
      protocol: "serial",
      hostname: "COM3",
      port: 0,
      name: "Quick Connect - COM3",
    });
    expect(connection.serialSettings).toMatchObject({
      portName: "COM3",
      baudRate: 115200,
      portSelection: { mode: "fixed" },
    });
    expect(connection.username).toBeUndefined();
    expect(connection.password).toBeUndefined();
  });

  it("rejects hostile addresses", () => {
    expect(() =>
      createQuickConnectConnection(
        { hostname: "/dev/sda", protocol: "serial" },
        "QC",
      ),
    ).toThrow();
  });
});
