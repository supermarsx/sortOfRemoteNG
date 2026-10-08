import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { originBrowserStartupError } from "../../src/hooks/protocol/originBrowserStartupError";

const runtime = readFileSync("src-tauri/src/origin_browser_runtime.rs", "utf8");
const names = [
  "PROXY_FAILED",
  "CONTEXT_FAILED",
  "COOKIE_RESTORE_FAILED",
  "VIEW_FAILED",
  "RENDERER_FAILED",
  "ZOOM_FAILED",
  "NAVIGATION_FAILED",
  "VIEW_TIMED_OUT",
];

describe("native browser per-view startup diagnostics", () => {
  it.each(names)(
    "recognizes the exact native %s message without disclosing arbitrary errors",
    (name) => {
      const message = runtime.match(
        new RegExp(`const ${name}: &str = "([^"]+)";`),
      )?.[1];
      expect(message).toBeTruthy();
      expect(originBrowserStartupError("create", message)).toEqual({
        stage: "create",
        category: "runtime",
        message: `Native browser startup failed (create). ${message}`,
      });
      expect(originBrowserStartupError("status", message).category).toBe("ipc");
      const appended = originBrowserStartupError(
        "create",
        `${message} https://user:secret@example.test/?token=secret`,
      );
      expect(appended.category).toBe("ipc");
      expect(appended.message).not.toMatch(/user:secret|example\.test|token=/);
    },
  );

  it("does not diagnose unknown manual startup failures as missing credentials", () => {
    const result = originBrowserStartupError(
      "create",
      new Error("unrecognized native failure"),
    );
    expect(result.message).toContain(
      "does not establish a credential or GPU failure",
    );
    expect(result.message).not.toContain("unrecognized native failure");
  });
});
