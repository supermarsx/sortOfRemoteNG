import { describe, expect, it, vi } from "vitest";
import {
  clearWebBrowserFrame,
  navigateWebBrowserFrame,
  EMPTY_WEB_FRAME_SANDBOX,
  PROXY_WEB_FRAME_SANDBOX,
} from "../../src/utils/protocol/webBrowserFrame";

const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43081/";
describe("website iframe navigation sandbox boundary", () => {
  it("restricts sandbox before navigating to blank (not an immediate revocation claim)", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", PROXY_WEB_FRAME_SANDBOX);
    const navigation = vi.fn();
    Object.defineProperty(iframe, "src", {
      set: (value) => navigation(value, iframe.getAttribute("sandbox")),
    });
    clearWebBrowserFrame(iframe);
    expect(navigation).toHaveBeenCalledExactlyOnceWith(
      "about:blank",
      EMPTY_WEB_FRAME_SANDBOX,
    );
  });
  it("enables only previous website flags before the isolated proxy navigation", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", EMPTY_WEB_FRAME_SANDBOX);
    const navigation = vi.fn();
    Object.defineProperty(iframe, "src", {
      set: (value) => navigation(value, iframe.getAttribute("sandbox")),
    });
    navigateWebBrowserFrame(iframe, `${proxy}login?x=a%20b`, proxy);
    expect(navigation).toHaveBeenCalledExactlyOnceWith(
      `${proxy}login?x=a%20b`,
      "allow-same-origin allow-scripts allow-forms",
    );
  });
  it.each([
    "about:blank",
    "javascript:alert(1)",
    "https://outside.example.test/",
    "http://localhost:43081/",
    "http://user:secret@p0123456789abcdef0123456789abcdef.localhost:43081/",
  ])("rejects %s before upgrading a blank frame", (url) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "");
    expect(() => navigateWebBrowserFrame(iframe, url, proxy)).toThrow();
    expect(iframe).toHaveAttribute("sandbox", "");
    expect(iframe).not.toHaveAttribute("src");
  });
  it("cannot use another session origin or the parent origin", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "");
    expect(() =>
      navigateWebBrowserFrame(
        iframe,
        `${proxy}x`,
        "http://pffffffffffffffffffffffffffffffff.localhost:43081/",
      ),
    ).toThrow();
    expect(() =>
      navigateWebBrowserFrame(
        iframe,
        document.location.href,
        document.location.origin,
      ),
    ).toThrow();
  });
});
