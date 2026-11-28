import { describe, expect, it } from "vitest";
import {
  defaultSSHConnectionConfig,
  defaultSSHTerminalConfig,
} from "../../src/types/ssh/sshSettings";
import { classifySshFailure } from "../../src/utils/ssh/sshFailure";
import {
  resolveSshProtocolConfig,
  sshProtocolOverrides,
  clearLegacySshProtocolField,
} from "../../src/utils/ssh/sshProtocolConfig";
import type { Connection } from "../../src/types/connection/connection";

describe("SSH protocol configuration inheritance", () => {
  it("inherits global values without creating connection overrides", () => {
    const global = {
      ...defaultSSHConnectionConfig,
      connectTimeout: 65,
      keepAliveInterval: 17,
      preferredKeyExchanges: ["global-kex"],
    };
    const effective = resolveSshProtocolConfig({}, global);
    expect(effective.connectTimeout).toBe(65);
    expect(effective.keepAliveInterval).toBe(17);
    expect(effective.preferredKeyExchanges).toEqual(["global-kex"]);
    expect(sshProtocolOverrides({})).toEqual({});
  });
  it("preserves old terminal and flat overrides while preferring new explicit values, including zero and empty arrays", () => {
    const connection: Partial<Connection> = {
      sshConnectTimeout: 42,
      sshTerminalConfigOverride: { preferredCiphers: ["legacy-cipher"] },
      sshConnectionConfigOverride: {
        keepAliveInterval: 0,
        preferredKeyExchanges: [],
      },
    };
    const effective = resolveSshProtocolConfig(connection, {
      ...defaultSSHConnectionConfig,
      preferredKeyExchanges: ["global-kex"],
    });
    expect(effective.connectTimeout).toBe(42);
    expect(effective.preferredCiphers).toEqual(["legacy-cipher"]);
    expect(effective.keepAliveInterval).toBe(0);
    expect(effective.preferredKeyExchanges).toEqual([]);
  });
  it("resetting an override removes its old location and inherits later global changes while keeping terminal appearance", () => {
    const connection: Partial<Connection> = {
      sshConnectTimeout: 42,
      sshTerminalConfigOverride: {
        preferredKeyExchanges: ["old-kex"],
        autoWrap: false,
        tcpOptions: {
          ...defaultSSHTerminalConfig.tcpOptions,
          connectionTimeout: 81,
        },
      },
    };
    let reset = clearLegacySshProtocolField(
      connection,
      "preferredKeyExchanges",
    );
    reset = clearLegacySshProtocolField(reset, "connectTimeout");
    const effective = resolveSshProtocolConfig(reset, {
      ...defaultSSHConnectionConfig,
      connectTimeout: 93,
      preferredKeyExchanges: ["new-global-kex"],
    });
    expect(effective.preferredKeyExchanges).toEqual(["new-global-kex"]);
    expect(effective.connectTimeout).toBe(93);
    expect(reset.sshTerminalConfigOverride?.autoWrap).toBe(false);
    expect(connection.sshConnectTimeout).toBe(42);
  });
  it("classifies the original error instead of words from the negotiation evidence", () => {
    const error =
      "SSH handshake failed: Session(-5) Unable to exchange encryption keys\nStage: Final target\nServer banner: certificate timeout transport\nSupported: rsa-cert-example";
    expect(classifySshFailure(error).kind).toBe("key_exchange");
  });
});
