import { describe, expect, it } from "vitest";
import type { Connection } from "../../types/connection/connection";
import { createDefaultPowerShellRemotingSettings } from "../../utils/powershell/normalizePowerShellRemoting";
import {
  buildPowerShellSessionOptions,
  PowerShellSequenceCursor,
} from "./powerShellSessionRuntime";

const connection = (): Connection => ({
  id: "powershell-1",
  name: "PowerShell",
  protocol: "winrm",
  hostname: "ps.example.test",
  port: 22,
  username: "admin",
  password: "secret",
  sshKnownHostsPath: "C:\\Users\\operator\\.ssh\\known_hosts",
  isGroup: false,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

describe("PowerShell live-session runtime", () => {
  it("builds a strict pinned password payload without changing protocol identity", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.transport = "ssh";
    settings.credential.username = "ps-admin";
    settings.ssh.authMethod = "password";
    settings.ssh.hostTrust = {
      mode: "pinned",
      fingerprint: "SHA256:abc123",
    };

    expect(buildPowerShellSessionOptions(connection(), settings)).toEqual(
      expect.objectContaining({
        transport: "ssh",
        options: expect.objectContaining({
          host: "ps.example.test",
          port: 22,
          username: "ps-admin",
          auth: { type: "password", password: "secret" },
          hostKeyPolicy: {
            type: "pinned_sha256",
            fingerprint: "SHA256:abc123",
          },
          connectionId: "powershell-1",
          subsystem: "powershell",
        }),
      }),
    );
  });

  it("uses an explicit known_hosts file and fails closed for unavailable modes", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.transport = "ssh";
    settings.ssh.authMethod = "privateKey";
    settings.ssh.privateKeyPath = "C:\\Keys\\id_ed25519";
    settings.ssh.hostTrust.mode = "strict";

    expect(buildPowerShellSessionOptions(connection(), settings)).toEqual(
      expect.objectContaining({
        transport: "ssh",
        options: expect.objectContaining({
          auth: expect.objectContaining({ type: "private_key" }),
          hostKeyPolicy: {
            type: "known_hosts",
            path: "C:\\Users\\operator\\.ssh\\known_hosts",
          },
        }),
      }),
    );

    settings.ssh.authMethod = "agent";
    expect(() => buildPowerShellSessionOptions(connection(), settings)).toThrow(
      /agent authentication is not available/i,
    );
    settings.ssh.authMethod = "password";
    settings.ssh.hostTrust.mode = "tofu";
    expect(() => buildPowerShellSessionOptions(connection(), settings)).toThrow(
      /Trust-on-first-use is not available/i,
    );
  });

  it("builds direct NTLM WSMan options with bounded limits and Trust Center verification", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.transport = "wsman";
    settings.credential.username = "LAB\\alice";
    settings.credential.domain = "LAB";
    settings.wsman.authMethod = "ntlm";
    settings.wsman.connectionUri =
      "https://win.example.test:15986/custom/wsman";
    settings.session.maxReceivedDataSizeMb = 50;
    settings.session.maxReceivedObjectSizeMb = 10;

    expect(buildPowerShellSessionOptions(connection(), settings)).toEqual({
      transport: "wsman",
      options: expect.objectContaining({
        endpoint: "https://win.example.test:15986/custom/wsman",
        username: "LAB\\alice",
        password: "secret",
        domain: "LAB",
        authentication: "ntlm",
        tlsTrust: "trust_center",
        networkPath: "direct",
        configurationName: "microsoft.powershell",
        maxEnvelopeBytes: 8 * 1024 * 1024,
        maxResponseBytes: 50 * 1024 * 1024,
      }),
    });
  });

  it("fails closed for unsafe WSMan security, unsupported auth, and configured routes", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.transport = "wsman";
    settings.credential.username = "alice";
    settings.wsman.authMethod = "basic";
    settings.wsman.scheme = "http";
    settings.wsman.port = 5985;
    expect(() => buildPowerShellSessionOptions(connection(), settings)).toThrow(
      /WSMan authentication.*HTTPS/i,
    );

    settings.wsman.authMethod = "ntlm";
    expect(() => buildPowerShellSessionOptions(connection(), settings)).toThrow(
      /WSMan authentication.*HTTPS/i,
    );

    settings.wsman.scheme = "https";
    settings.wsman.port = 5986;
    settings.wsman.authMethod = "kerberos";
    expect(() => buildPowerShellSessionOptions(connection(), settings)).toThrow(
      /Kerberos authentication is not supported/i,
    );

    settings.wsman.authMethod = "ntlm";
    settings.wsman.tls.skipHostnameCheck = true;
    expect(() => buildPowerShellSessionOptions(connection(), settings)).toThrow(
      /TLS verification bypasses are blocked/i,
    );

    settings.wsman.tls.skipHostnameCheck = false;
    settings.networkPath.mode = "connectionPath";
    expect(() => buildPowerShellSessionOptions(connection(), settings)).toThrow(
      /direct Network Path/i,
    );

    settings.networkPath.mode = "direct";
    settings.wsman.proxy.mode = "http";
    expect(() => buildPowerShellSessionOptions(connection(), settings)).toThrow(
      /proxies are not materialized/i,
    );
  });

  it("deduplicates replay and rejects invalid sequence numbers", () => {
    const cursor = new PowerShellSequenceCursor();
    expect(cursor.accept(1)).toBe(true);
    expect(cursor.accept(1)).toBe(false);
    expect(cursor.accept(0)).toBe(false);
    expect(cursor.accept(Number.NaN)).toBe(false);
    expect(cursor.accept(2)).toBe(true);
    expect(cursor.value).toBe(2);
  });
});
