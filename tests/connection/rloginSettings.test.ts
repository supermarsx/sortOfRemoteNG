import { describe, expect, it } from "vitest";
import {
  DIRECT_RLOGIN_NETWORK_PATH,
  RLOGIN_DEFAULT_PORT,
  RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE,
  type RloginNetworkPathCapability,
} from "../../src/types/connection/rloginSettings";
import {
  RloginTerminalDecoder,
  acknowledgeRloginPlaintext,
  createDefaultRloginSettings,
  encodeRloginTerminalInput,
  formatRloginEscapeByte,
  getRloginFlowControlAction,
  isRloginPlaintextAcknowledged,
  migrateRloginSettings,
  normalizeRloginEncoding,
  parseRloginEscapeCharacter,
  resetRloginPlaintextAcknowledgement,
  validateRloginSettings,
} from "../../src/utils/rlogin/rloginSettings";

const acknowledgedSettings = () =>
  acknowledgeRloginPlaintext(
    {
      ...createDefaultRloginSettings(),
      localUsername: "local-user",
      remoteUsername: "remote-user",
    },
    new Date("2026-07-15T12:00:00.000Z"),
  );

describe("RLogin settings model", () => {
  it("uses secure versioned defaults without a password field", () => {
    const settings = createDefaultRloginSettings();
    expect(settings.version).toBe(1);
    expect(RLOGIN_DEFAULT_PORT).toBe(513);
    expect(settings.sourcePortMode).toBe("ephemeral");
    expect(settings.encoding).toBe("utf-8");
    expect(settings.plaintextAcknowledgement).toEqual({
      version: 1,
      scope: RLOGIN_PLAINTEXT_ACKNOWLEDGEMENT_SCOPE,
      acknowledged: false,
    });
    expect(settings).not.toHaveProperty("password");
  });

  it("migrates safe legacy aliases and resets unscoped consent", () => {
    const migrated = migrateRloginSettings({
      local_user: "alice",
      remoteUser: "root",
      terminal_type: "vt100",
      terminal_speed: "9600",
      encoding: "CP1252",
      rows: 40,
      columns: 132,
      plaintextAcknowledgement: { acknowledged: true },
    });
    expect(migrated).toMatchObject({
      version: 1,
      localUsername: "alice",
      remoteUsername: "root",
      terminalType: "vt100",
      terminalSpeed: 9600,
      encoding: "windows-1252",
      initialRows: 40,
      initialColumns: 132,
    });
    expect(isRloginPlaintextAcknowledged(migrated)).toBe(false);
  });

  it("preserves valid inactive values and can reset scoped consent", () => {
    const acknowledged = acknowledgedSettings();
    const migrated = migrateRloginSettings({
      ...acknowledged,
      escapeEnabled: false,
      escapeCharacter: "^]",
      tcpKeepAlive: false,
      tcpKeepAliveSeconds: 17,
      sourcePortMode: "ephemeral",
      reservedPortStart: 600,
      reservedPortEnd: 700,
    });
    expect(migrated.escapeCharacter).toBe("^]");
    expect(migrated.tcpKeepAliveSeconds).toBe(17);
    expect(migrated.reservedPortStart).toBe(600);
    expect(isRloginPlaintextAcknowledged(migrated)).toBe(true);

    const reset = resetRloginPlaintextAcknowledgement(migrated);
    expect(isRloginPlaintextAcknowledged(reset)).toBe(false);
    expect(reset.plaintextAcknowledgement.acknowledgedAt).toBeUndefined();
    expect(
      migrateRloginSettings(migrated, {
        resetPlaintextAcknowledgement: true,
      }).plaintextAcknowledgement.acknowledged,
    ).toBe(false);
  });

  it("validates NUL, UTF-8 byte limits, port, and acknowledgement", () => {
    const settings = {
      ...createDefaultRloginSettings(),
      localUsername: "bad\0user",
      remoteUsername: "é".repeat(129),
      terminalType: "",
    };
    const result = validateRloginSettings(settings, {
      port: 0,
      networkPath: DIRECT_RLOGIN_NETWORK_PATH,
    });
    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "nul-byte",
        "field-too-long",
        "required",
        "out-of-range",
        "plaintext-not-acknowledged",
      ]),
    );
  });

  it("fails closed for unsupported paths and reserved ports through a path", () => {
    const networkPath: RloginNetworkPathCapability = {
      configured: true,
      supported: false,
      summary: "Unsupported dynamic route",
      layers: [{ kind: "unsupported", label: "Dynamic route" }],
    };
    const result = validateRloginSettings(
      { ...acknowledgedSettings(), sourcePortMode: "reserved" },
      { port: 513, networkPath },
    );
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "network-path-unsupported" }),
        expect.objectContaining({ code: "reserved-port-network-path" }),
        expect.objectContaining({ code: "reserved-port-privileges" }),
      ]),
    );
    expect(result.valid).toBe(false);
  });

  it("warns when automatic source ports are forced ephemeral by a path", () => {
    const result = validateRloginSettings(
      { ...acknowledgedSettings(), sourcePortMode: "auto" },
      {
        port: 513,
        networkPath: {
          configured: true,
          supported: true,
          summary: "SOCKS5 to target",
          layers: [{ kind: "socks5", label: "SOCKS5" }],
        },
      },
    );
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "auto-port-network-path",
        severity: "warning",
      }),
    );
  });

  it("normalizes supported encoding aliases", () => {
    expect(normalizeRloginEncoding("UTF8")).toBe("utf-8");
    expect(normalizeRloginEncoding("latin_1")).toBe("iso-8859-1");
    expect(normalizeRloginEncoding("CP1252")).toBe("windows-1252");
    expect(normalizeRloginEncoding("unsupported")).toBe("utf-8");
  });

  it("encodes and incrementally decodes supported terminal bytes", () => {
    const utf8 = encodeRloginTerminalInput("A€", "utf-8");
    expect(utf8.lossy).toBe(false);
    const decoder = new RloginTerminalDecoder("utf-8");
    expect(decoder.decode(utf8.bytes.slice(0, 2))).toBe("A");
    expect(decoder.decode(utf8.bytes.slice(2))).toBe("€");
    expect(decoder.flush()).toBe("");

    expect(encodeRloginTerminalInput("€", "windows-1252")).toEqual({
      bytes: Uint8Array.from([0x80]),
      lossy: false,
    });
    expect(
      new RloginTerminalDecoder("windows-1252").decode(
        Uint8Array.from([0x80]),
        false,
      ),
    ).toBe("€");
    expect(encodeRloginTerminalInput("🙂", "iso-8859-1").lossy).toBe(true);
  });

  it("applies XON/XOFF only in cooked mode", () => {
    expect(getRloginFlowControlAction(0x13, "cooked", true)).toBe(
      "pause-output",
    );
    expect(getRloginFlowControlAction(0x11, "cooked", true)).toBe(
      "resume-output",
    );
    expect(getRloginFlowControlAction(0x13, "raw", true)).toBeUndefined();
    expect(getRloginFlowControlAction(0x13, "cooked", false)).toBeUndefined();
  });

  it("parses and formats safe single-byte escape notation", () => {
    expect(parseRloginEscapeCharacter("~")).toBe(0x7e);
    expect(parseRloginEscapeCharacter("^]")).toBe(0x1d);
    expect(parseRloginEscapeCharacter("\\x1b")).toBe(0x1b);
    expect(parseRloginEscapeCharacter("\0")).toBeUndefined();
    expect(parseRloginEscapeCharacter("é")).toBeUndefined();
    expect(formatRloginEscapeByte(0x1d)).toBe("^]");
    expect(formatRloginEscapeByte(0x7e)).toBe("~");
  });
});
