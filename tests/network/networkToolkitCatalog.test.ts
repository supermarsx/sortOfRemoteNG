import { describe, expect, it } from "vitest";
import { NETWORK_TOOL_IDS } from "../../src/types/network/networkToolkit";
import {
  NETWORK_TOOLKIT_CATALOG as catalog,
  buildToolkitRequest,
  createToolkitDraft,
} from "../../src/utils/network/networkToolkitCatalog";

describe("network toolkit request catalog", () => {
  it("covers each native tool once and has no implicit network routes", () => {
    expect(catalog.map((tool) => tool.id).sort()).toEqual(
      [...NETWORK_TOOL_IDS].sort(),
    );
    expect(new Set(catalog.map((tool) => tool.id)).size).toBe(26);
    for (const tool of catalog) expect(createToolkitDraft(tool).route).toBe("");
    expect(
      catalog
        .filter((tool) => tool.route === "proxy")
        .map((tool) => tool.id)
        .sort(),
    ).toEqual(["http", "publicIp", "rdap", "tls", "website"]);
  });
  it.each(["hash", "ipCalculator"])(
    "%s is local, ignores dormant proxy settings, and allowlists options",
    (id) => {
      const tool = catalog.find((tool) => tool.id === id)!;
      const draft = {
        ...createToolkitDraft(tool),
        target: id === "hash" ? "" : "192.0.2.1/24",
        proxyUrl: "http://unused.example",
        options: { unexpected: "ignored" },
      };
      const request = buildToolkitRequest(tool, draft);
      expect(request.route).toBe("direct");
      expect(request.proxyUrl).toBeUndefined();
      expect(request.options).not.toHaveProperty("unexpected");
    },
  );
  it.each([0, 499, 60001, 500.5, NaN, Infinity])(
    "rejects timeout %s",
    (timeoutMs) => {
      const tool = catalog.find((tool) => tool.id === "hash")!;
      expect(() =>
        buildToolkitRequest(tool, { ...createToolkitDraft(tool), timeoutMs }),
      ).toThrow(/Timeout/);
    },
  );
  it.each([
    "-n",
    "host;echo",
    "https://example.org",
    "user@host",
    "a b",
    "host\nother",
  ])("rejects host syntax %s", (target) => {
    const tool = catalog[0];
    expect(() =>
      buildToolkitRequest(tool, {
        ...createToolkitDraft(tool),
        route: "direct",
        target,
      }),
    ).toThrow();
  });
  it("rejects proxy bypasses and unsafe URL schemes", () => {
    const ping = catalog[0];
    expect(() =>
      buildToolkitRequest(ping, {
        ...createToolkitDraft(ping),
        target: "example.org",
        route: "httpProxy",
        proxyUrl: "http://localhost:8080",
      }),
    ).toThrow(/direct-only/);
    const http = catalog.find((tool) => tool.id === "http")!;
    for (const target of [
      "file:///tmp/test",
      "javascript:alert(1)",
      "https://user:secret@example.org",
    ])
      expect(() =>
        buildToolkitRequest(http, {
          ...createToolkitDraft(http),
          target,
          route: "direct",
        }),
      ).toThrow();
  });
  it("accepts both timeout boundaries and preserves explicit direct without sending a dormant proxy", () => {
    const tool = catalog[0];
    for (const timeoutMs of [500, 60000]) {
      const request = buildToolkitRequest(tool, {
        ...createToolkitDraft(tool),
        target: "::1",
        route: "direct",
        timeoutMs,
        proxyUrl: "http://unused.example",
      });
      expect(request.timeoutMs).toBe(timeoutMs);
      expect(request.proxyUrl).toBeUndefined();
    }
  });

  it.each([
    ["portCheck", ["port", "localAddress"]],
    ["smtp", ["port", "ehloName", "localAddress"]],
    ["ntp", ["port", "localAddress"]],
    ["dhcp", ["localAddress"]],
    ["http", ["method", "maxRedirects", "maxBytes"]],
    ["website", ["method", "maxRedirects", "maxBytes"]],
    ["tls", ["port"]],
    ["whois", ["server", "followReferral"]],
    ["rdap", ["endpoint", "maxRedirects", "maxBytes"]],
    ["publicIp", ["endpoint", "maxRedirects"]],
  ])("exposes only the implemented %s options", (id, keys) => {
    const tool = catalog.find((tool) => tool.id === id)!;
    expect(tool.fields.map((field) => field.key)).toEqual(keys);
  });

  it.each([
    [
      "http",
      "https://example.org",
      { method: "GET", maxRedirects: "5", maxBytes: "1048576" },
    ],
    ["smtp", "example.org", { port: "25", ehloName: "localhost" }],
    ["ntp", "example.org", { port: "123" }],
    [
      "whois",
      "example.org",
      { server: "whois.iana.org", followReferral: "true" },
    ],
    [
      "publicIp",
      "",
      { endpoint: "https://api.ipify.org?format=json", maxRedirects: "5" },
    ],
  ] as const)("matches the native %s defaults", (id, target, options) => {
    const tool = catalog.find((tool) => tool.id === id)!;
    expect(
      buildToolkitRequest(tool, {
        ...createToolkitDraft(tool),
        target,
        route: "direct",
      }).options,
    ).toEqual(options);
  });

  it("validates protocol fields, traffic consent and DHCP source before run", () => {
    const port = catalog.find((tool) => tool.id === "portCheck")!;
    const draft = {
      ...createToolkitDraft(port),
      target: "192.0.2.1",
      route: "direct" as const,
    };
    expect(() => buildToolkitRequest(port, draft)).toThrow(/tcp port/);
    for (const value of ["0", "65536", "22.5"])
      expect(() =>
        buildToolkitRequest(port, { ...draft, options: { port: value } }),
      ).toThrow(/TCP port/);
    for (const value of [
      "Ethernet",
      "0.0.0.0",
      "255.255.255.255",
      "ff02::1",
      "::",
    ])
      expect(() =>
        buildToolkitRequest(port, {
          ...draft,
          options: { port: "443", localAddress: value },
        }),
      ).toThrow(/Local source IP/);
    const dhcp = catalog.find((tool) => tool.id === "dhcp")!;
    expect(() =>
      buildToolkitRequest(dhcp, { ...draft, confirmTraffic: true }),
    ).toThrow(/local ipv4/);
    for (const value of ["::1", "0.0.0.1", "224.0.0.1"])
      expect(() =>
        buildToolkitRequest(dhcp, {
          ...draft,
          confirmTraffic: true,
          options: { localAddress: value },
        }),
      ).toThrow();
    expect(
      buildToolkitRequest(dhcp, {
        ...draft,
        confirmTraffic: true,
        options: { localAddress: "192.0.2.2", port: "9999" },
      }).options,
    ).toEqual({ localAddress: "192.0.2.2", confirmTraffic: "true" });
    for (const target of [
      "::1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "127.1",
    ])
      expect(() =>
        buildToolkitRequest(dhcp, {
          ...draft,
          target,
          confirmTraffic: true,
          options: { localAddress: "192.0.2.2" },
        }),
      ).toThrow();
  });

  it("keeps TLS HTTPS-only without overriding URL ports implicitly", () => {
    const tool = catalog.find((tool) => tool.id === "tls")!;
    const draft = { ...createToolkitDraft(tool), route: "direct" as const };
    for (const target of [
      "example.org",
      "::1",
      "https://example.org:8443/path",
    ])
      expect(buildToolkitRequest(tool, { ...draft, target }).options).toEqual(
        {},
      );
    expect(() =>
      buildToolkitRequest(tool, { ...draft, target: "http://example.org" }),
    ).toThrow(/HTTPS/);
    expect(() =>
      buildToolkitRequest(tool, {
        ...draft,
        target: "https://example.org:8443",
        options: { port: "443" },
      }),
    ).toThrow(/conflicts/);
  });

  it("rejects unsafe provider endpoints, command injection and unsupported HTTP methods", () => {
    for (const id of ["http", "rdap", "publicIp", "whois", "smtp"]) {
      const tool = catalog.find((tool) => tool.id === id)!;
      const draft = {
        ...createToolkitDraft(tool),
        target: id === "http" ? "https://example.org" : "example.org",
        route: "direct" as const,
      };
      const badOptions: Record<string, string> =
        id === "http"
          ? { method: "POST" }
          : id === "whois"
            ? { server: "host\r\ncommand" }
            : id === "smtp"
              ? { ehloName: "localhost\r\nMAIL FROM:<test>" }
              : { endpoint: "https://user:secret@example.org" };
      expect(() =>
        buildToolkitRequest(tool, {
          ...draft,
          options: { ...draft.options, ...badOptions },
        }),
      ).toThrow();
    }
    const rdap = catalog.find((tool) => tool.id === "rdap")!;
    expect(() =>
      buildToolkitRequest(rdap, {
        ...createToolkitDraft(rdap),
        target: "example.org",
        route: "direct",
        options: { endpoint: "https://example.org?query=wrong" },
      }),
    ).toThrow(/base URL/);
    const http = catalog.find((tool) => tool.id === "http")!;
    for (const target of [
      "https://@example.org",
      "https://example.org:0",
      "https://example.org\\other",
      "https://example.org/a b",
    ])
      expect(() =>
        buildToolkitRequest(http, {
          ...createToolkitDraft(http),
          target,
          route: "direct",
        }),
      ).toThrow();
  });
});
