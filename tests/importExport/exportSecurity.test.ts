import { describe, expect, it } from "vitest";
import {
  containsExportSecrets,
  stripExportSecrets,
} from "../../src/components/ImportExport/exportSecurity";

describe("exportSecurity", () => {
  it("strips connection, settings, header, integration, and inline VPN secrets", () => {
    const payload = {
      connections: [
        {
          id: "ssh-1",
          hostname: "host.example.test",
          password: "connection-password",
          privateKey:
            "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate\n-----END OPENSSH PRIVATE KEY-----",
          httpHeaders: {
            Authorization: "Bearer sensitive-token",
            "X-Trace": "keep-me",
          },
        },
      ],
      settings: {
        theme: "light",
        integration: {
          apiKey: "integration-key",
          endpoint: "https://integration.example.test",
        },
      },
      sidecars: {
        vpn: {
          name: "WireGuard",
          rawConfiguration:
            "[Interface]\nPrivateKey = very-private-wireguard-key\nAddress = 10.0.0.2/32",
        },
        proxy: {
          host: "proxy.example.test",
          proxyPassword: "proxy-password",
        },
      },
      exportMetadata: {
        inclusion: { includeCredentials: false },
      },
    };

    expect(containsExportSecrets(payload)).toBe(true);

    const sanitized = stripExportSecrets(payload);

    expect(sanitized).toMatchObject({
      connections: [
        {
          id: "ssh-1",
          hostname: "host.example.test",
          httpHeaders: { "X-Trace": "keep-me" },
        },
      ],
      settings: {
        theme: "light",
        integration: { endpoint: "https://integration.example.test" },
      },
      sidecars: {
        vpn: { name: "WireGuard" },
        proxy: { host: "proxy.example.test" },
      },
      exportMetadata: {
        inclusion: { includeCredentials: false },
      },
    });
    expect(containsExportSecrets(sanitized)).toBe(false);
  });

  it("removes secret-bearing URLs and serialized credential blobs", () => {
    const sanitized = stripExportSecrets({
      webhook:
        "https://hooks.example.test/callback?access_token=plain-text-token",
      serialized: '{"client_secret":"plain-text-secret"}',
      documentation: "No credential material is present here.",
    });

    expect(sanitized).toEqual({
      documentation: "No credential material is present here.",
    });
    expect(containsExportSecrets(sanitized)).toBe(false);
  });
});
