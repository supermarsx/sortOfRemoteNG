import { describe, expect, it } from "vitest";
import {
  canonicalPowerShellEndpoint,
  createDefaultPowerShellRemotingSettings,
  normalizePowerShellRemotingSettings,
  validatePowerShellRemotingSettings,
} from "./normalizePowerShellRemoting";

describe("PowerShell Remoting settings schema", () => {
  it("creates deterministic, credential-free defaults", () => {
    const first = createDefaultPowerShellRemotingSettings();
    const second = createDefaultPowerShellRemotingSettings();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.schemaVersion).toBe(1);
    expect(first.transport).toBe("wsman");
    expect(first.wsman.scheme).toBe("https");
    expect(first.credential.source).toBe("prompt");
    expect(JSON.stringify(first).toLowerCase()).not.toContain("password");
  });

  it("migrates the legacy remoting config without carrying inline secrets or WMI", () => {
    const result = normalizePowerShellRemotingSettings({
      computerName: "server.example.test",
      transport: "http",
      port: 15985,
      authMethod: "credssp",
      credential: {
        username: "operator",
        domain: "EXAMPLE",
        password: "must-not-survive",
      },
      uriPath: "//custom///wsman/",
      skipCaCheck: true,
      skipCnCheck: true,
      enableReconnect: false,
      sessionOption: {
        operationTimeoutSec: 90,
        maxConnectionRetryCount: 7,
      },
      wmiNamespace: "root/cimv2",
    });

    expect(result.migratedFromVersion).toBe("legacy");
    expect(result.settings.transport).toBe("wsman");
    expect(result.settings.wsman).toMatchObject({
      scheme: "http",
      port: 15985,
      path: "/custom/wsman",
      authMethod: "credSsp",
    });
    expect(result.settings.credential).toMatchObject({
      source: "prompt",
      username: "operator",
      domain: "EXAMPLE",
    });
    expect(result.settings.session.operationTimeoutSec).toBe(90);
    expect(result.settings.session.reconnect).toMatchObject({
      enabled: false,
      maxAttempts: 7,
    });
    expect(JSON.stringify(result.settings)).not.toContain("must-not-survive");
    expect(result.warnings.join(" ")).toMatch(/inline passwords/i);
    expect(result.warnings.join(" ")).toMatch(/WMI.*separate/i);
  });

  it("normalizes current settings idempotently", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.credential.username = "admin";
    settings.networkPath = {
      mode: "connectionPath",
      pathId: "route-1",
      summary: "VPN → bastion",
    };

    const once = normalizePowerShellRemotingSettings(settings);
    const twice = normalizePowerShellRemotingSettings(once.settings);

    expect(once.migratedFromVersion).toBeUndefined();
    expect(once.warnings).toEqual([]);
    expect(twice.settings).toEqual(once.settings);
    expect(twice.warnings).toEqual([]);
  });

  it("blocks WSMan authentication over HTTP", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.wsman.scheme = "http";
    settings.wsman.port = 5985;
    settings.wsman.authMethod = "basic";

    expect(validatePowerShellRemotingSettings(settings)).toContainEqual(
      expect.objectContaining({
        path: "wsman.authMethod",
        code: "basicRequiresTls",
        severity: "error",
      }),
    );
  });

  it("builds canonical credential-free WSMan, custom, IPv6, and SSH endpoints", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    expect(canonicalPowerShellEndpoint(settings, "server.example.test")).toBe(
      "https://server.example.test:5986/wsman",
    );
    expect(canonicalPowerShellEndpoint(settings, "2001:db8::12")).toBe(
      "https://[2001:db8::12]:5986/wsman",
    );

    settings.wsman.connectionUri =
      "http://host.example.test:7777//admin///wsman/";
    expect(canonicalPowerShellEndpoint(settings, "ignored.example.test")).toBe(
      "http://host.example.test:7777/admin/wsman",
    );

    settings.transport = "ssh";
    settings.ssh.subsystem = "PowerShell Core";
    expect(canonicalPowerShellEndpoint(settings, "host.example.test")).toBe(
      "ssh://host.example.test:22/PowerShell%20Core",
    );
  });

  it("rejects endpoint credentials and incomplete references", () => {
    const settings = createDefaultPowerShellRemotingSettings();
    settings.wsman.connectionUri =
      "https://user:secret@server.example.test/wsman?unsafe=true";
    settings.credential.source = "vault";
    settings.credential.vaultRef = { secretId: "" };
    settings.wsman.tls.trustMode = "pinned";

    const issues = validatePowerShellRemotingSettings(settings);
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "invalidEndpoint",
        "missingCredentialReference",
        "missingFingerprint",
      ]),
    );
  });
});
