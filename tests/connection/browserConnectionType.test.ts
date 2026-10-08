import { describe, expect, it } from "vitest";
import {
  browserConnectionTypeOptions,
  browserProtocolPort,
  changeBrowserProtocol,
  connectionTypeValue,
  resolveConnectionType,
} from "../../src/utils/connection/browserConnectionType";

describe("Browser connection type representation", () => {
  it("groups both transports once, without changing the source options or capabilities", () => {
    const options = [
      { value: "http", label: "HTTP" },
      { value: "https", label: "HTTPS" },
      { value: "ssh", label: "SSH" },
    ];
    expect(
      browserConnectionTypeOptions(options).map(({ value }) => value),
    ).toEqual(["browser", "ssh"]);
    expect(options.map(({ value }) => value)).toEqual(["http", "https", "ssh"]);
    expect(browserConnectionTypeOptions(options.slice(2))).toEqual(
      options.slice(2),
    );
  });

  it("uses HTTPS for a newly selected Browser, preserving either saved transport", () => {
    expect(resolveConnectionType("browser", "ssh")).toBe("https");
    for (const protocol of ["http", "https"] as const) {
      expect(connectionTypeValue(protocol)).toBe("browser");
      expect(resolveConnectionType("browser", protocol)).toBe(protocol);
      const current = {
        protocol,
        hostname: `${protocol}://example.test/a?x=%2F#b`,
        port: 8443,
        authType: "digest" as const,
      };
      expect(changeBrowserProtocol(current, protocol)).toBe(current);
    }
  });

  it.each([
    ["http", 80, "https", 443],
    ["https", 443, "http", 80],
    ["http", 8080, "https", 8080],
    ["https", 8443, "http", 8443],
  ] as const)(
    "switches %s:%i to %s:%i without resetting authentication",
    (protocol, port, next, expected) => {
      expect(
        changeBrowserProtocol(
          {
            protocol,
            port,
            hostname: "example.test",
            authType: "digest",
            username: "user",
            httpVerifySsl: false,
          },
          next,
        ),
      ).toEqual({
        protocol: next,
        port: expected,
        hostname: "example.test",
        authType: "digest",
        username: "user",
        httpVerifySsl: false,
      });
    },
  );

  it("changes only the URL scheme, preserving explicit default ports, IPv6, case and encoded suffixes", () => {
    const current = {
      protocol: "http" as const,
      port: 80,
      hostname: "http://[::1]:80/Case%2fPath?return=%2F#anchor",
    };
    expect(changeBrowserProtocol(current, "https")).toEqual({
      ...current,
      protocol: "https",
      hostname: "https://[::1]:80/Case%2fPath?return=%2F#anchor",
    });
    expect(browserProtocolPort("ssh", 22, "https")).toBe(443);
  });
});
