import { describe, expect, it } from "vitest";
import {
  EDITOR_WEB_ADDRESS_ERROR,
  EDITOR_WEB_ADDRESS_CONFLICT,
  changeEditorAddressPort,
  normalizeEditorAddress,
} from "../../src/utils/connection/normalizeEditorAddress";

describe("explicit web editor addresses", () => {
  it("refuses to retarget an unchanged conflicting saved address during unrelated edits", () => {
    const original = {
      protocol: "https" as const,
      hostname: "https://example.test:8443/page",
      port: 9443,
    };
    expect(() =>
      normalizeEditorAddress(
        { ...original, name: "Only name changed" },
        original,
      ),
    ).toThrow(EDITOR_WEB_ADDRESS_CONFLICT);
    expect(normalizeEditorAddress(original)).toMatchObject({ port: 8443 });
  });
  it.each([
    ["https://example.test/login", 8443],
    ["https://example.test:8443/login", 443],
  ] as const)(
    "preserves a valid saved URL %s with separate port %s during unrelated edits",
    (hostname, port) => {
      const original = { protocol: "https" as const, hostname, port };
      const draft = { ...original, name: "Only name changed" };
      expect(normalizeEditorAddress(draft, original)).toBe(draft);
    },
  );
  it.each([
    "https://example.test:8443/path?x=1#two",
    "https://example.test/path?x=1#two",
    "https://[2001:db8::1]:8443/path?x=1#two",
  ])("retains explicit Port edits for %s", (hostname) => {
    const changed = changeEditorAddressPort(
      { protocol: "https", hostname, port: 8443 },
      9443,
    );
    expect(changed.hostname).toContain(":9443/path?x=1#two");
    expect(normalizeEditorAddress(changed)).toMatchObject({ port: 9443 });
  });
  it("does not rewrite invalid address text when the Port changes", () => {
    const hostname = "https://user:PRIVATE@example.test/path";
    expect(
      changeEditorAddressPort({ protocol: "https", hostname }, 9443),
    ).toMatchObject({ hostname, port: 9443 });
  });
  it.each([
    ["http://example.test/login?q=one%2Ftwo#part", "http", 80],
    ["https://example.test/login?q=one%2Ftwo#part", "https", 443],
    ["HTTPS://example.test:443/path?x=1#two", "https", 443],
    ["http://example.test:443/path", "http", 443],
    ["https://example.test:8443/path", "https", 8443],
    ["https://[2001:db8::1]:9443/path?x=1#two", "https", 9443],
  ] as const)(
    "preserves %s and replaces separate scheme/port controls",
    (hostname, protocol, port) => {
      const original = {
        protocol: "https" as const,
        hostname,
        port: 12345,
        name: "Kept",
      };
      expect(normalizeEditorAddress(original)).toEqual({
        ...original,
        protocol,
        port,
      });
      expect(original.port).toBe(12345);
    },
  );
  it.each(["example.test:8080", "192.0.2.1:8080", "[2001:db8::1]:8080"])(
    "extracts a port from %s without changing selected HTTPS",
    (hostname) => {
      expect(
        normalizeEditorAddress({ protocol: "https", hostname, port: 443 }),
      ).toEqual({ protocol: "https", hostname, port: 8080 });
    },
  );
  it("retains custom ports for bare names and trims only harmless outside spaces", () => {
    expect(
      normalizeEditorAddress({
        protocol: "http",
        hostname: "  example.test  ",
        port: 8081,
      }),
    ).toEqual({ protocol: "http", hostname: "example.test", port: 8081 });
    const unchanged = {
      protocol: "https" as const,
      hostname: "example.test",
      port: 443,
    };
    expect(normalizeEditorAddress(unchanged)).toBe(unchanged);
  });
  it("brackets a bare IPv6 address without interpreting its last segment as a port", () => {
    expect(
      normalizeEditorAddress({
        protocol: "https",
        hostname: "2001:db8::1:8080",
        port: 9443,
      }),
    ).toEqual({
      protocol: "https",
      hostname: "[2001:db8::1:8080]",
      port: 9443,
    });
  });
  it.each([
    "https://user:PRIVATE@example.test/path",
    "https://@example.test/",
    "https://example.test:0/path",
    "https://example.test:65536/path",
    "https://example.test:/path",
    "https://example.test\\other/path",
    "https://example.test/path\\other",
    "https://exa%6dple.test/path",
    "javascript:alert(1)",
    "ftp://example.test/path",
    "//example.test/path",
    "example.test/path?x=1#two",
    "\nhttps://example.test",
    "https://example.test/\tpath",
    "",
  ])(
    "refuses unsafe or ambiguous input %s without mutating it or leaking it",
    (hostname) => {
      const original = { protocol: "https" as const, hostname, port: 443 };
      expect(() => normalizeEditorAddress(original)).toThrow(
        EDITOR_WEB_ADDRESS_ERROR,
      );
      expect(original.hostname).toBe(hostname);
    },
  );
  it("does not reinterpret SSH, integration endpoints or folder addresses", () => {
    for (const original of [
      { protocol: "ssh" as const, hostname: "server:22", port: 22 },
      { protocol: "rdp" as const, hostname: "server:3389", port: 3389 },
      { protocol: "https" as const, hostname: "", isGroup: true },
    ])
      expect(normalizeEditorAddress(original)).toBe(original);
  });
});
