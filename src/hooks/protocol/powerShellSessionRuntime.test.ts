import { describe, expect, it } from "vitest";
import type { Connection } from "../../types/connection/connection";
import { createDefaultPowerShellRemotingSettings } from "../../utils/powershell/normalizePowerShellRemoting";
import {
  buildPowerShellSshSessionOptions,
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

    expect(buildPowerShellSshSessionOptions(connection(), settings)).toEqual(
      expect.objectContaining({
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
    );
  });

  it("uses an explicit known_hosts file and fails closed for unavailable modes", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.transport = "ssh";
    settings.ssh.authMethod = "privateKey";
    settings.ssh.privateKeyPath = "C:\\Keys\\id_ed25519";
    settings.ssh.hostTrust.mode = "strict";

    expect(buildPowerShellSshSessionOptions(connection(), settings)).toEqual(
      expect.objectContaining({
        auth: expect.objectContaining({ type: "private_key" }),
        hostKeyPolicy: {
          type: "known_hosts",
          path: "C:\\Users\\operator\\.ssh\\known_hosts",
        },
      }),
    );

    settings.transport = "wsman";
    expect(() =>
      buildPowerShellSshSessionOptions(connection(), settings),
    ).toThrow(/WSMan is unavailable/i);
    settings.transport = "ssh";
    settings.ssh.authMethod = "agent";
    expect(() =>
      buildPowerShellSshSessionOptions(connection(), settings),
    ).toThrow(/agent authentication is not available/i);
    settings.ssh.authMethod = "password";
    settings.ssh.hostTrust.mode = "tofu";
    expect(() =>
      buildPowerShellSshSessionOptions(connection(), settings),
    ).toThrow(/Trust-on-first-use is not available/i);
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
