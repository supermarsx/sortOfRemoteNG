import { describe, expect, it, vi } from "vitest";
import {
  clearWebBrowserFrame,
  navigateWebBrowserFrame,
  EMPTY_WEB_FRAME_SANDBOX,
  PROXY_WEB_FRAME_SANDBOX,
} from "../../src/utils/protocol/webBrowserFrame";

const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43081/";
describe("website iframe navigation sandbox boundary", () => {
  it("does not navigate an already restricted blank document again", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", EMPTY_WEB_FRAME_SANDBOX);
    iframe.setAttribute("src", "about:blank");
    const navigation = vi.fn();
    Object.defineProperty(iframe, "src", { set: navigation });
    clearWebBrowserFrame(iframe);
    clearWebBrowserFrame(iframe);
    expect(navigation).not.toHaveBeenCalled();
    expect(iframe).toHaveAttribute("sandbox", "");
  });
  it("does navigate a permissive blank so restrictive sandbox flags actually take effect", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", PROXY_WEB_FRAME_SANDBOX);
    iframe.setAttribute("src", "about:blank");
    const navigation = vi.fn();
    Object.defineProperty(iframe, "src", { set: navigation });
    clearWebBrowserFrame(iframe);
    expect(navigation).toHaveBeenCalledWith("about:blank");
    expect(iframe).toHaveAttribute("sandbox", "");
  });
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
  it("accepts only explicitly supplied document aliases from the protected listener", () => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", EMPTY_WEB_FRAME_SANDBOX);
    const account = "http://p11111111111111111111111111111111.localhost:43081/";
    navigateWebBrowserFrame(iframe, `${account}ServiceLogin?continue=service`, [
      proxy,
      account,
    ]);
    expect(iframe.getAttribute("src")).toBe(
      `${account}ServiceLogin?continue=service`,
    );
    expect(() =>
      navigateWebBrowserFrame(
        iframe,
        "http://p22222222222222222222222222222222.localhost:43081/",
        [proxy, account],
      ),
    ).toThrow();
    expect(() =>
      navigateWebBrowserFrame(iframe, `${account}ServiceLogin`, [
        proxy,
        "https://accounts.google.com/",
      ]),
    ).toThrow();
    expect(() =>
      navigateWebBrowserFrame(iframe, `${account}ServiceLogin`, [
        proxy,
        "http://p11111111111111111111111111111111.localhost:43082/",
      ]),
    ).toThrow();
  });
});
