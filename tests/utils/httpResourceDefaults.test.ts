import { describe, expect, it } from "vitest";
import {
  normalizeHttpProxyPolicy,
  normalizeExternalResourceOrigins,
} from "../../src/utils/connection/httpProxyPolicy";
import { resolveBrowserProxyPolicy } from "../../src/utils/settings/webBrowserSettings";
import defaults from "../../src/utils/protocol/commonResourceOrigins.json";

describe("common external resource defaults", () => {
  it("copies default script and style grants without allowing arbitrary Google APIs", () => {
    const first = normalizeHttpProxyPolicy(undefined);
    expect(first.externalResourceOrigins).toEqual(defaults);
    expect(
      first.externalResourceOrigins?.find(
        (row) => row.origin === "https://ajax.googleapis.com",
      )?.kinds,
    ).toEqual(["script"]);
    expect(
      first.externalResourceOrigins?.find(
        (row) => row.origin === "https://apis.google.com",
      )?.kinds,
    ).toEqual(["script"]);
    expect(
      first.externalResourceOrigins?.some((row) => row.origin.includes("*")),
    ).toBe(false);
    first.externalResourceOrigins![0].kinds.push("stylesheet");
    first.externalResourceOrigins!.pop();
    expect(normalizeHttpProxyPolicy(undefined).externalResourceOrigins).toEqual(
      defaults,
    );
  });

  it("keeps explicit saved opt-outs including empty origin lists on roundtrip", () => {
    const policy = {
      ...normalizeHttpProxyPolicy(undefined),
      allowExternalFonts: false,
      externalFontOrigins: [],
      externalResourceOrigins: [],
    };
    expect(
      resolveBrowserProxyPolicy(JSON.parse(JSON.stringify(policy)), undefined),
    ).toEqual(policy);
  });

  it("preserves stricter script and same-origin settings", () => {
    const policy = normalizeHttpProxyPolicy({
      ...normalizeHttpProxyPolicy(undefined),
      sameOriginOnly: true,
      pageScripts: "block",
    });
    expect(policy).toMatchObject({
      sameOriginOnly: true,
      pageScripts: "block",
    });
    expect(policy.externalResourceOrigins).toEqual(defaults);
  });

  it("canonicalizes and roundtrips exact HTTPS origins and selected kinds", () => {
    expect(
      normalizeExternalResourceOrigins([
        { origin: " HTTPS://CDN.EXAMPLE:443/ ", kinds: ["stylesheet"] },
      ]),
    ).toEqual([{ origin: "https://cdn.example", kinds: ["stylesheet"] }]);
  });

  it.each([
    null,
    {},
    "https://cdn.example",
    [{ origin: "http://cdn.example", kinds: ["script"] }],
    [{ origin: "https://*.example", kinds: ["script"] }],
    [{ origin: "https://cdn.example/file.js", kinds: ["script"] }],
    [{ origin: "https://user:password@cdn.example", kinds: ["script"] }],
    [{ origin: "https://cdn.example", kinds: [] }],
    [{ origin: "https://cdn.example", kinds: ["fetch"] }],
    [{ origin: "https://cdn.example", kinds: ["script", "script"] }],
    [{ origin: "https://cdn.example", kinds: ["script"], cookies: true }],
    [
      { origin: "https://cdn.example", kinds: ["script"] },
      { origin: "https://CDN.EXAMPLE/", kinds: ["stylesheet"] },
    ],
    Array.from({ length: 17 }, (_, i) => ({
      origin: `https://cdn${i}.example`,
      kinds: ["script"],
    })),
  ])("rejects malformed or broader grants %#", (value) => {
    expect(() => normalizeExternalResourceOrigins(value)).toThrow();
  });
});
