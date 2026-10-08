import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { originBrowserStartupError } from "../../src/hooks/protocol/originBrowserStartupError";

const runtime = readFileSync("src-tauri/src/origin_browser_runtime.rs", "utf8");
const authority = readFileSync(
  "src-tauri/src/origin_browser_authority.rs",
  "utf8",
);
const mfaOriginFailure = authority.match(
  /#\[error\("([^"\n]+)"\)\]\s*MfaOriginMismatch,/,
)?.[1];
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
  it("surfaces the exact native MFA origin mismatch with review/re-enable/save guidance", () => {
    expect(mfaOriginFailure).toBeTruthy();
    for (const error of [mfaOriginFailure, new Error(mfaOriginFailure)]) {
      const result = originBrowserStartupError("create", error);
      expect(result).toEqual({
        stage: "create",
        category: "connection",
        message: `Native browser startup failed (create). ${mfaOriginFailure}`,
      });
      expect(result.message).toContain("re-enable automatic codes");
      expect(result.message).toContain("save the connection");
      expect(result.message).toContain(
        "password and authenticator are unchanged",
      );
    }
  });

  it.each(["listen", "status", "owner-check", "resync"] as const)(
    "does not infer MFA authority validation from the %s stage",
    (stage) => {
      const result = originBrowserStartupError(stage, mfaOriginFailure);
      expect(result.stage).toBe(stage);
      expect(result.category).toBe(
        stage === "owner-check" ? "connection" : "ipc",
      );
      expect(result.message).not.toContain("authenticator");
      expect(result.message).not.toContain("re-enable automatic codes");
    },
  );

  it("redacts decorated or object-supplied MFA errors instead of matching a prefix", () => {
    expect(mfaOriginFailure).toBeTruthy();
    for (const error of [
      `${mfaOriginFailure} https://user:secret@example.test/?token=secret`,
      new Error(`${mfaOriginFailure}\nstack with SYNTHETIC-SEED`),
      { message: mfaOriginFailure },
      {
        get message() {
          throw new Error("must not read a getter");
        },
      },
    ]) {
      const result = originBrowserStartupError("create", error);
      expect(result.category).toBe("ipc");
      expect(result.message).not.toMatch(
        /authenticator|user:secret|example\.test|token=|SYNTHETIC-SEED/,
      );
    }
  });

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
