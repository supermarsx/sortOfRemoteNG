import { describe, expect, it } from "vitest";
import {
  appendWebNetworkReport,
  parseWebNetworkReport,
  webNetworkRoutingStatus,
} from "../../src/utils/protocol/webNetworkReport";
import { parseWebNetworkGuardStatus } from "../../src/utils/protocol/webNetworkGuard";
const document = {
  sessionId: "proxy-1",
  token: "a".repeat(32),
  sequence: 7,
  navigationToken: "b".repeat(32),
  url: "http://p0123456789abcdef0123456789abcdef.localhost:43123/",
};
const report = {
  type: "sorng_web_network_blocked",
  version: 1,
  sessionId: document.sessionId,
  documentToken: document.token,
  documentSequence: document.sequence,
  navigationToken: document.navigationToken,
  url: document.url,
  kind: "fetch",
  reason: "origin-not-approved",
  origin: "https://cdn.example",
};
const routingReceipt = {
  version: 6,
  tacticalRmmApi: false,
  tacticalRmmApiOrigins: [],
  fetchInterception: true,
  xhrInterception: true,
  pageNetworkInterception: true,
  quickConnectNavigation: false,
  quickConnectDiscovery: false,
  quickConnectDiscovered: false,
  quickConnectDirectNavigation: false,
  quickConnectRegionalNavigation: false,
};
describe("untrusted page network report boundary", () => {
  it("distinguishes missing page module from disabled and mismatched capabilities without leaking input", () => {
    for (const value of [
      undefined,
      null,
      { version: 1 },
      { version: 2, quickConnectNavigation: true, quickConnectDiscovery: true },
      {
        version: 5,
        quickConnectNavigation: "private",
        quickConnectDiscovery: true,
      },
    ])
      expect(webNetworkRoutingStatus(value, true).status).toBe("missing");
    expect(webNetworkRoutingStatus(routingReceipt, false)).toEqual({
      status: "current",
      tacticalRmmApi: false,
      tacticalRmmApiExpected: false,
      tacticalRmmApiOrigins: [],
      fetchInterception: true,
      xhrInterception: true,
      pageNetworkInterception: true,
      quickConnectNavigation: false,
      quickConnectDiscovery: false,
      quickConnectDiscovered: false,
      quickConnectDirectNavigation: false,
      quickConnectRegionalNavigation: false,
    });
    expect(webNetworkRoutingStatus(routingReceipt, true).status).toBe(
      "mismatch",
    );
    expect(
      webNetworkRoutingStatus(
        {
          ...routingReceipt,
          quickConnectNavigation: true,
          quickConnectDiscovery: true,
          quickConnectDiscovered: true,
          quickConnectDirectNavigation: true,
          quickConnectRegionalNavigation: true,
          credentials: "private",
        },
        true,
        true,
      ),
    ).toEqual({
      status: "current",
      tacticalRmmApi: false,
      tacticalRmmApiExpected: false,
      tacticalRmmApiOrigins: [],
      fetchInterception: true,
      xhrInterception: true,
      pageNetworkInterception: true,
      quickConnectNavigation: true,
      quickConnectDiscovery: true,
      quickConnectDiscovered: true,
      quickConnectDirectNavigation: true,
      quickConnectRegionalNavigation: true,
    });
  });
  it("requires the current alias capabilities but accepts an aliasless or disabled source", () => {
    const aliasless = {
      ...routingReceipt,
      quickConnectNavigation: true,
      quickConnectDiscovery: false,
      quickConnectDiscovered: false,
      quickConnectDirectNavigation: false,
      quickConnectRegionalNavigation: false,
    };
    expect(webNetworkRoutingStatus(aliasless, true, false).status).toBe(
      "current",
    );
    expect(webNetworkRoutingStatus(aliasless, true, true).status).toBe(
      "mismatch",
    );
    const all = {
      ...aliasless,
      quickConnectDiscovery: true,
      quickConnectDiscovered: true,
      quickConnectDirectNavigation: true,
      quickConnectRegionalNavigation: true,
    };
    expect(webNetworkRoutingStatus(all, true, true).status).toBe("current");
    expect(webNetworkRoutingStatus(all, false, false).status).toBe("mismatch");
    expect(webNetworkRoutingStatus(all, true, true, true)).toMatchObject({
      status: "mismatch",
      tacticalRmmApi: false,
      tacticalRmmApiExpected: true,
    });
    expect(
      webNetworkRoutingStatus(
        {
          ...all,
          tacticalRmmApi: true,
          tacticalRmmApiOrigins: ["https://api.rmm.example.test"],
        },
        true,
        true,
        true,
      ).status,
    ).toBe("current");
    for (const key of [
      "tacticalRmmApi",
      "quickConnectDiscovered",
      "quickConnectDirectNavigation",
      "quickConnectRegionalNavigation",
    ])
      for (const value of [undefined, "true", 1, {}, null])
        expect(
          webNetworkRoutingStatus({ ...all, [key]: value }, true, true).status,
        ).toBe("missing");
  });
  it("requires exact canonical Tactical origins and working page hooks", () => {
    const receipt = {
      ...routingReceipt,
      tacticalRmmApi: true,
      tacticalRmmApiOrigins: [
        "https://api.rmm.apps.vogue-homes.com",
        "https://api.apps.vogue-homes.com",
      ],
    };
    expect(webNetworkRoutingStatus(receipt, false, false, true)).toMatchObject({
      status: "current",
      tacticalRmmApiOrigins: receipt.tacticalRmmApiOrigins,
      fetchInterception: true,
      xhrInterception: true,
      pageNetworkInterception: true,
    });
    for (const change of [
      { tacticalRmmApiOrigins: ["https://api.example.test/path"] },
      { tacticalRmmApiOrigins: ["http://api.example.test"] },
      { tacticalRmmApiOrigins: ["https://api.example.test/"] },
      { tacticalRmmApiOrigins: ["https://localhost"] },
      { tacticalRmmApiOrigins: ["https://user:secret@api.example.test"] },
      {
        tacticalRmmApiOrigins: [
          "https://api.example.test",
          "https://api.example.test",
        ],
      },
      {
        tacticalRmmApiOrigins: Array.from(
          { length: 4 },
          (_, index) => `https://api${index}.example.test`,
        ),
      },
    ])
      expect(
        webNetworkRoutingStatus({ ...receipt, ...change }, false, false, true)
          .status,
      ).toBe("missing");
    for (const change of [
      { fetchInterception: false },
      { xhrInterception: false },
      { pageNetworkInterception: false },
    ])
      expect(
        webNetworkRoutingStatus({ ...receipt, ...change }, false, false, true)
          .status,
      ).toBe("mismatch");
    expect(
      webNetworkRoutingStatus(
        { ...routingReceipt, pageNetworkInterception: false },
        false,
      ).status,
    ).toBe("mismatch");
    expect(webNetworkRoutingStatus(receipt, false, false, false).status).toBe(
      "mismatch",
    );
    expect(
      webNetworkRoutingStatus(
        {
          ...routingReceipt,
          tacticalRmmApiOrigins: ["https://api.example.test"],
        },
        false,
      ).status,
    ).toBe("mismatch");
    for (const change of [
      { tacticalRmmApiOrigins: "https://api.example.test" },
      { fetchInterception: "true" },
      { xhrInterception: null },
      { pageNetworkInterception: 1 },
    ])
      expect(
        webNetworkRoutingStatus({ ...receipt, ...change }, false, false, true)
          .status,
      ).toBe("missing");
  });
  it("accepts a fenced fixed QuickConnect method reason without including page-supplied body details", () => {
    expect(
      parseWebNetworkReport(
        {
          ...report,
          reason: "quickconnect-control-method",
          origin: "https://global.quickconnect.to",
          body: "private-server-id",
        },
        document,
      ),
    ).toEqual({
      kind: "fetch",
      reason: "quickconnect-control-method",
      origin: "https://global.quickconnect.to",
    });
  });
  it("accepts a fenced font category without exporting path or page errors", () => {
    expect(
      parseWebNetworkReport(
        { ...report, kind: "font", error: "private" },
        document,
      ),
    ).toEqual({
      kind: "font",
      reason: "origin-not-approved",
      origin: "https://cdn.example",
    });
  });
  it("returns only closed diagnostic categories and an exact origin", () => {
    expect(
      parseWebNetworkReport(
        { ...report, body: "secret", headers: { Authorization: "secret" } },
        document,
      ),
    ).toEqual({
      kind: "fetch",
      reason: "origin-not-approved",
      origin: "https://cdn.example",
    });
  });
  it.each([
    { sessionId: "other" },
    { documentToken: "c".repeat(32) },
    { documentSequence: 6 },
    { navigationToken: null },
    { url: document.url + "other" },
    { version: 2 },
    { kind: "secret" },
    { reason: "raw server body" },
    { origin: "https://cdn.example/path?token=secret" },
    { origin: "https://user:secret@cdn.example" },
    { origin: "file:///secret" },
    { origin: "https://cdn.example/" },
    { origin: "x".repeat(2049) },
  ])("rejects stale or unsafe report %j", (change) => {
    expect(
      parseWebNetworkReport({ ...report, ...change }, document),
    ).toBeNull();
  });
  it("caps and deduplicates diagnostics without growing the stored payload", () => {
    const first = parseWebNetworkReport(report, document)!;
    const rows = [first];
    expect(appendWebNetworkReport(rows, first)).toBe(rows);
    const full = Array.from({ length: 32 }, (_, index) => ({
      ...first,
      origin: `https://host${index}.example`,
    }));
    expect(appendWebNetworkReport(full, first)).toBe(full);
  });
});
describe("native frame guard status contract", () => {
  it("accepts the Windows native guard separately from cross-platform page coverage", () => {
    for (const status of [
      { platform: "windows", frameNavigation: "enforced" },
      { platform: "linux", frameNavigation: "unsupported" },
    ])
      expect(
        parseWebNetworkGuardStatus({
          ...status,
          allNetworkRequestsMediated: false,
        }).allNetworkRequestsMediated,
      ).toBe(false);
    expect(
      parseWebNetworkGuardStatus({
        platform: "windows",
        frameNavigation: "enforced",
        allNetworkRequestsMediated: true,
      }).allNetworkRequestsMediated,
    ).toBe(true);
  });
  it.each([
    undefined,
    {},
    {
      platform: "windows",
      frameNavigation: "unsupported",
      allNetworkRequestsMediated: false,
    },
    {
      platform: "windows",
      frameNavigation: "guess",
      allNetworkRequestsMediated: false,
    },
  ])("rejects unavailable or overstated protection %j", (value) => {
    expect(() => parseWebNetworkGuardStatus(value)).toThrow();
  });
});
