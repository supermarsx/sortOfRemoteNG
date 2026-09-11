import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import capability from "../../src-tauri/capabilities/default.json";
import {
  EMPTY_WEB_FRAME_SANDBOX,
  PROXY_WEB_FRAME_SANDBOX,
  clearWebBrowserFrame,
  navigateWebBrowserFrame,
} from "../../src/utils/protocol/webBrowserFrame";

const contentAreaSource = readFileSync(
  join(
    process.cwd(),
    "src",
    "components",
    "protocol",
    "webBrowser",
    "ContentArea.tsx",
  ),
  "utf8",
);

describe("embedded web content isolation", () => {
  it("does not authorize remote origins in the production capability", () => {
    expect("remote" in capability).toBe(false);
  });

  it("keeps cookie-compatible isolation without popup or download escapes", () => {
    expect(contentAreaSource).toContain("sandbox={EMPTY_WEB_FRAME_SANDBOX}");
    expect(EMPTY_WEB_FRAME_SANDBOX).toBe("");
    const frame = document.createElement("iframe");
    clearWebBrowserFrame(frame);
    expect(frame.getAttribute("sandbox")).toBe("");
    const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
    navigateWebBrowserFrame(frame, `${proxy}/portal`, proxy);
    expect(frame.getAttribute("sandbox")).toBe(PROXY_WEB_FRAME_SANDBOX);
    expect(new Set(frame.getAttribute("sandbox")!.split(/\s+/u))).toEqual(
      new Set(["allow-same-origin", "allow-scripts", "allow-forms"]),
    );
    clearWebBrowserFrame(frame);
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(frame.getAttribute("src")).toBe("about:blank");
  });

  it("does not enable scripts for an unapproved website or app-origin target", () => {
    const frame = document.createElement("iframe");
    clearWebBrowserFrame(frame);
    const proxy = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
    for (const target of [
      "https://foreign.example/",
      document.location.origin,
    ]) {
      expect(() => navigateWebBrowserFrame(frame, target, proxy)).toThrow();
      expect(frame.getAttribute("sandbox")).toBe("");
      expect(frame.getAttribute("src")).toBe("about:blank");
    }
  });
});
