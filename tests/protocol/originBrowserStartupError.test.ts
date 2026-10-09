import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  originBrowserPolicyFailures,
  originBrowserStartupError,
} from "../../src/hooks/protocol/originBrowserStartupError";

const runtime = readFileSync("src-tauri/src/origin_browser_runtime.rs", "utf8");
const authority = readFileSync(
  "src-tauri/src/origin_browser_authority.rs",
  "utf8",
);
const mfaOriginFailure = authority.match(
  /#\[error\("([^"\n]+)"\)\]\s*MfaOriginMismatch,/,
)?.[1];
const names = [
  ["PROXY_FAILED", "private-proxy"],
  ["CONTEXT_FAILED", "private-context"],
  ["COOKIE_RESTORE_FAILED", "cookie-restore"],
  ["VIEW_FAILED", "embedded-view"],
  ["RENDERER_FAILED", "renderer-setup"],
  ["ZOOM_FAILED", "initial-zoom"],
  ["NAVIGATION_FAILED", "initial-navigation"],
  ["VIEW_TIMED_OUT", "tab-timeout"],
  ["DATA_DIRECTORY_FAILED", "working-data"],
  ["PACKAGE_FAILED", "runtime-package"],
  ["STARTUP_TIMED_OUT", "runtime-timeout"],
  ["STARTUP_FAILED", "runtime-readiness"],
];

describe("native browser per-view startup diagnostics", () => {
  it("surfaces the exact native MFA origin mismatch with review/re-enable/save guidance", () => {
    expect(mfaOriginFailure).toBeTruthy();
    for (const error of [mfaOriginFailure, new Error(mfaOriginFailure)]) {
      const result = originBrowserStartupError("create", error);
      expect(result).toEqual({
        stage: "create",
        category: "connection",
        code: "mfa-origin-mismatch",
        reason: "mfa-origin-mismatch",
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
      expect(result).not.toHaveProperty("reason");
      expect(result).not.toHaveProperty("code");
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
      expect(result).not.toHaveProperty("reason");
      expect(result.message).not.toMatch(
        /authenticator|user:secret|example\.test|token=|SYNTHETIC-SEED/,
      );
    }
  });

  it.each(names)(
    "recognizes the exact native %s message without disclosing arbitrary errors",
    (name, code) => {
      const message = runtime.match(
        new RegExp(`const ${name}: &str = "([^"]+)";`),
      )?.[1];
      expect(message).toBeTruthy();
      expect(originBrowserStartupError("create", message)).toEqual({
        stage: "create",
        category: "runtime",
        code,
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

  it.each([
    ["InvalidRequest", "request-invalid"],
    ["OwnerUnavailable", "owner-unavailable"],
    ["SourceMismatch", "source-mismatch"],
    ["PolicyUnsupported", "permissions-invalid"],
    ["SettingsUnavailable", "settings-unavailable"],
    ["PreferencesInvalid", "preferences-invalid"],
    ["CapabilitiesInvalid", "capabilities-invalid"],
    ["CertificatePolicyUnsupported", "certificate-policy"],
    ["ApplicationUnsupported", "application-unsupported"],
    ["RouteUnsupported", "network-route"],
    ["CredentialUnavailable", "credential-reference"],
  ])("retains the exact native authority %s code", (variant, code) => {
    const message = authority.match(
      new RegExp(`#\\[error\\("([^"\\n]+)"\\)\\]\\s*${variant},`),
    )?.[1];
    expect(message).toBeTruthy();
    expect(originBrowserStartupError("create", message).code).toBe(code);
    expect(originBrowserStartupError("status", message).code).toBeUndefined();
    expect(
      originBrowserStartupError("create", `${message} SECRET`).code,
    ).toBeUndefined();
  });

  it("recognizes the reported website wording without a substring match", () => {
    const native = "Saved website permission policy is invalid or unsupported";
    expect(originBrowserStartupError("create", native).code).toBe(
      "permissions-invalid",
    );
    for (const raw of [
      `${native}.`,
      `${native}\nSECRET`,
      `prefix ${native}`,
      { message: native },
    ]) {
      const result = originBrowserStartupError("create", raw);
      expect(result.code).toBeUndefined();
      expect(result.message).not.toContain("SECRET");
    }
  });

  it("covers every fixed native policy and preference validation rule", () => {
    const source = readFileSync(
      "src-tauri/src/origin_browser_permission_validation.rs",
      "utf8",
    );
    const rules = [
      ...source.matchAll(
        /"([^"\n]*(?:must |unsupported |schema validation failed)[^"\n]*)"/g,
      ),
    ].map((match) => match[1]);
    expect(rules.length).toBeGreaterThan(30);
    for (const rule of rules) {
      expect(
        originBrowserPolicyFailures.some((entry) =>
          entry.native.endsWith(`: ${rule}`),
        ),
        rule,
      ).toBe(true);
    }
  });

  it("keeps policy codes unique, exact, and restricted to native creation", () => {
    expect(
      new Set(originBrowserPolicyFailures.map((entry) => entry.code)).size,
    ).toBe(originBrowserPolicyFailures.length);
    expect(
      new Set(originBrowserPolicyFailures.map((entry) => entry.native)).size,
    ).toBe(originBrowserPolicyFailures.length);
    for (const { native, code } of originBrowserPolicyFailures) {
      expect(
        originBrowserStartupError("create", new Error(native)),
      ).toMatchObject({ code, category: "connection" });
      expect(
        originBrowserStartupError("create", native).reason,
      ).toBeUndefined();
      for (const stage of [
        "listen",
        "status",
        "owner-check",
        "resync",
      ] as const) {
        expect(originBrowserStartupError(stage, native).code).toBeUndefined();
      }
      const decorated = originBrowserStartupError(
        "create",
        `${native} https://SECRET/?token=SECRET`,
      );
      expect(decorated.code).toBeUndefined();
      expect(decorated.message).not.toContain("SECRET");
    }
  });

  it("does not access an Error message getter or stringify unknown exceptions", () => {
    const error = new Error();
    Object.defineProperty(error, "message", {
      get() {
        throw new Error("must not execute");
      },
    });
    expect(originBrowserStartupError("create", error).code).toBeUndefined();
    expect(
      originBrowserStartupError("create", {
        toString() {
          throw new Error("must not execute");
        },
      }).code,
    ).toBeUndefined();
  });
});
