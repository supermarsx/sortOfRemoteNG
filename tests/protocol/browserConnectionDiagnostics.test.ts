import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { browserConnectionDiagnosticFacts } from "../../src/utils/protocol/browserConnectionDiagnostics";

describe("fixed saved browser connection diagnostics", () => {
  it("classifies Webmin over a local SSH forward without disclosing configuration values", () => {
    const connection = {
      protocol: "https",
      hostname: "PRIVATE_HOST",
      port: 10000,
      id: "PRIVATE_ID",
      username: "PRIVATE_USER",
      password: "PRIVATE_PASSWORD",
      httpApplication: { version: 1, id: "webmin", loginMode: "manual" },
      tunnelProfileId: "PRIVATE_PROFILE",
      security: {
        tunnelChain: [
          {
            id: "PRIVATE_LAYER",
            name: "PRIVATE_NAME",
            type: "ssh-tunnel",
            enabled: true,
            sshTunnel: {
              forwardType: "local",
              host: "PRIVATE_SSH_HOST",
              connectionId: "PRIVATE_SSH_ID",
              ownerDatabaseId: "PRIVATE_DB",
              privateKey: "PRIVATE_KEY",
              remoteHost: "PRIVATE_REMOTE",
            },
          },
        ],
      },
    } as unknown as Connection;
    const facts = Object.fromEntries(
      browserConnectionDiagnosticFacts(connection),
    );
    expect(facts).toMatchObject({
      "Saved connection type": "HTTPS",
      "Browser application": "Webmin",
      "Saved route references": "Saved tunnel profile",
      "Configured route kinds": "ssh-tunnel",
      "SSH forwarding modes": "local",
      "Route execution": "Not confirmed; saved configuration only",
    });
    expect(JSON.stringify(facts)).not.toContain("PRIVATE_");
    expect(connection.security!.tunnelChain![0].sshTunnel!.connectionId).toBe(
      "PRIVATE_SSH_ID",
    );
  });
  it.each(["local", "remote", "dynamic"])(
    "reports the fixed %s forwarding mode",
    (mode) => {
      const connection = {
        protocol: "http",
        security: {
          tunnelChain: [
            {
              type: "ssh-tunnel",
              enabled: true,
              sshTunnel: { forwardType: mode },
            },
          ],
        },
      } as unknown as Connection;
      expect(
        Object.fromEntries(browserConnectionDiagnosticFacts(connection))[
          "SSH forwarding modes"
        ],
      ).toBe(mode);
    },
  );
  it("recognizes a local-forward route without exposing its SSH source", () => {
    const facts = Object.fromEntries(
      browserConnectionDiagnosticFacts({
        protocol: "https",
        security: {
          tunnelChain: [
            {
              type: "local-forward",
              enabled: true,
              sshTunnel: { forwardType: "local", host: "PRIVATE_SSH_HOST" },
            },
          ],
        },
      } as unknown as Connection),
    );
    expect(facts["Configured route kinds"]).toBe("local-forward");
    expect(facts["SSH forwarding modes"]).toBe("local");
    expect(JSON.stringify(facts)).not.toContain("PRIVATE_");
  });
  it("reports enabled legacy and inline proxy categories and keeps disabled routes out", () => {
    const connection = {
      protocol: "https",
      proxyChainId: "PRIVATE_CHAIN",
      security: {
        sshTunnel: { enabled: true },
        proxy: { enabled: true, type: "socks5", host: "PRIVATE_PROXY" },
        tunnelChain: [
          { type: "wireguard", enabled: false },
          {
            type: "proxy",
            enabled: true,
            proxy: { proxyType: "http-connect" },
          },
        ],
      },
    } as unknown as Connection;
    const facts = Object.fromEntries(
      browserConnectionDiagnosticFacts(connection),
    );
    expect(facts["Configured route kinds"]).toBe("proxy, ssh-tunnel");
    expect(facts["Configured proxy types"]).toBe("socks5, http-connect");
    expect(facts["SSH forwarding modes"]).toBe("local (legacy)");
    expect(JSON.stringify(facts)).not.toMatch(/PRIVATE_|wireguard/);
  });
  it("never echoes unknown protocol, application, route or forwarding strings", () => {
    const connection = {
      protocol: "SECRET_PROTOCOL",
      httpApplication: { id: "SECRET_APPLICATION" },
      security: {
        proxy: { enabled: true, type: "SECRET_PROXY" },
        tunnelChain: [
          { type: "SECRET_ROUTE", enabled: true },
          {
            type: "ssh-jump",
            enabled: true,
            sshTunnel: { forwardType: "SECRET_FORWARD" },
          },
        ],
      },
    } as unknown as Connection;
    const facts = Object.fromEntries(
      browserConnectionDiagnosticFacts(connection),
    );
    expect(facts["Saved connection type"]).toBe("Unknown");
    expect(facts["Browser application"]).toBe("Custom/unknown");
    expect(facts["Configured route kinds"]).toBe("proxy, Unknown, ssh-jump");
    expect(facts["SSH forwarding modes"]).toBe("Unknown");
    expect(JSON.stringify(facts)).not.toContain("SECRET_");
  });
  it("does not imply direct routing or successful execution for unresolved references or missing data", () => {
    const facts = Object.fromEntries(
      browserConnectionDiagnosticFacts({
        protocol: "https",
        proxyProfileId: "PRIVATE_PROFILE",
      }),
    );
    expect(facts["Configured route kinds"]).toBe(
      "Saved reference; not expanded",
    );
    expect(facts["Route execution"]).toContain("Not confirmed");
    expect(
      Object.fromEntries(browserConnectionDiagnosticFacts())[
        "Saved connection type"
      ],
    ).toBe("Not reported");
  });
});
