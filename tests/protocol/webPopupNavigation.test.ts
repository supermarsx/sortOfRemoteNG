import { describe, expect, it } from "vitest";
import {
  popupProxyUrl,
  popupUpstreamUrl,
} from "../../src/utils/protocol/webPopupNavigation";
import type { WebPopupSnapshot } from "../../src/utils/protocol/webPopupTabs";

const proxyUrl = `http://p${"a".repeat(32)}.localhost:9000/`;
const source = "https://rmm.example.test/login";
const popup: WebPopupSnapshot = {
  id: "child",
  sourceSessionId: "source",
  sourceConnectionId: "rmm",
  ownerDatabaseId: "db",
  sourceWindowId: undefined,
  proxyUrl,
  url: `${proxyUrl}takecontrol/agent?opaque=a%2fb+&&__sorng_popup_parent_v1=3&keep=%26%3d#screen`,
  document: {
    generation: 1,
    sequence: 3,
    sessionId: "native",
    token: "b".repeat(32),
    navigationToken: null,
  },
};
describe("shared browser navigation", () => {
  it("hides only the parent marker and preserves signed query bytes", () => {
    const upstream = popupUpstreamUrl(popup, source);
    expect(upstream).toBe(
      "https://rmm.example.test/takecontrol/agent?opaque=a%2fb+&&keep=%26%3d#screen",
    );
    expect(popupProxyUrl(popup, source, upstream)).toBe(
      `${proxyUrl}takecontrol/agent?opaque=a%2fb+&&keep=%26%3d&__sorng_popup_parent_v1=3#screen`,
    );
  });
  it.each([
    "https://evil.test/takecontrol/agent",
    "http://rmm.example.test/",
    "https://rmm.example.test:444/",
    "https://user:password@rmm.example.test/",
    "javascript:alert(1)",
    `${source}?__sorng_navigation_v1=123`,
    `${source}?%5f%5fsorng_popup_parent_v1=9`,
    "https://rmm.example.test/__sortofremoteng_tactical_rmm_api_v1",
  ])("rejects a foreign authority or reserved control URL: %s", (url) => {
    expect(() => popupProxyUrl(popup, source, url)).toThrow();
  });
  it("cannot accept an unprotected report or escape via double-slash paths", () => {
    expect(() =>
      popupUpstreamUrl(popup, source, "https://evil.test/"),
    ).toThrow();
    expect(popupUpstreamUrl(popup, source, `${proxyUrl}/evil.test/path`)).toBe(
      "https://rmm.example.test//evil.test/path",
    );
  });
});
