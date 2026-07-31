import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import capability from "../../src-tauri/capabilities/default.json";

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

const sandboxMatch = contentAreaSource.match(/sandbox="([^"]+)"/u);
const sandboxTokens = new Set(sandboxMatch?.[1].split(/\s+/u) ?? []);

describe("embedded web content isolation", () => {
  it("does not authorize remote origins in the production capability", () => {
    expect("remote" in capability).toBe(false);
  });

  it("keeps cookie-compatible isolation without popup or download escapes", () => {
    expect(sandboxMatch).not.toBeNull();
    expect(sandboxTokens.has("allow-same-origin")).toBe(true);
    expect(sandboxTokens.has("allow-scripts")).toBe(true);
    expect(sandboxTokens.has("allow-forms")).toBe(true);
    expect(sandboxTokens.has("allow-popups")).toBe(false);
    expect(sandboxTokens.has("allow-popups-to-escape-sandbox")).toBe(false);
    expect(sandboxTokens.has("allow-downloads")).toBe(false);
  });
});
