import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  originBrowserPolicyFailures,
  originBrowserStartRetriesExhausted,
  originBrowserStartTimeout,
  originBrowserStartupError,
  originBrowserStartupRetryable,
  originBrowserStartupStale,
} from "../../src/hooks/protocol/originBrowserStartupError";

const runtime = readFileSync("src-tauri/src/origin_browser_runtime.rs", "utf8");
const authority = readFileSync(
  "src-tauri/src/origin_browser_authority.rs",
  "utf8",
);
const mfaOriginFailure = authority.match(
  /#\[error\("([^"\n]+)"\)\]\s*MfaOriginMismatch,/,
)?.[1];
const mfaOriginAuthenticationDisplay = mfaOriginFailure?.replace(
  "In Application settings,",
  "In Authentication,",
);
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
  it.each(["service", "connect", "forward", "owner"] as const)(
    "recognizes only the exact fixed native SSH %s failure",
    (stage) => {
      const native = `Saved browser SSH route is unavailable (${stage}); review its saved SSH connection and tunnel settings; no direct fallback`;
      expect(authority).toContain(
        "Saved browser SSH route is unavailable ({stage}); review its saved SSH connection and tunnel settings; no direct fallback",
      );
      for (const input of [native, new Error(native)]) {
        const result = originBrowserStartupError("create", input);
        expect(result).toMatchObject({
          category: "connection",
          code: `ssh-route-${stage}`,
        });
        expect(result.message).toContain("no direct fallback");
        expect(originBrowserStartupRetryable(result)).toBe(false);
      }
      for (const message of [
        `${native} SECRET_SSH_PASSWORD`,
        `SECRET_HOST ${native}`,
        `${native}\nSECRET_PRIVATE_KEY`,
      ]) {
        const result = originBrowserStartupError("create", message);
        expect(result.code).toBeUndefined();
        expect(result.message).not.toContain("SECRET");
      }
      for (const startupStage of [
        "listen",
        "status",
        "owner-check",
        "resync",
      ] as const) {
        const result = originBrowserStartupError(startupStage, native);
        expect(result.code).toBeUndefined();
        expect(result.message).not.toContain(
          `SSH route could not complete its ${stage}`,
        );
      }
    },
  );
  it.each([
    "dns",
    "transport",
    "handshake",
    "host-key",
    "authentication",
    "timeout",
    "capacity",
    "cancelled",
    "unknown",
  ])(
    "preserves the fixed SSH connection %s cause only at browser creation",
    (reason) => {
      const native = `Saved browser SSH route is unavailable (connect-${reason}); review its saved SSH connection and tunnel settings; no direct fallback`;
      expect(originBrowserStartupError("create", native)).toMatchObject({
        category: "connection",
        code: `ssh-route-connect-${reason}`,
      });
      for (const received of [`${native}: SECRET`, `SECRET ${native}`]) {
        const failure = originBrowserStartupError("create", received);
        expect(failure.code).toBeUndefined();
        expect(failure.message).not.toContain("SECRET");
      }
      expect(originBrowserStartupError("resync", native).code).toBeUndefined();
    },
  );
  it("does not accept an unknown SSH stage as a diagnostic or expose its value", () => {
    const result = originBrowserStartupError(
      "create",
      "Saved browser SSH route is unavailable (SECRET_STAGE); review its saved SSH connection and tunnel settings; no direct fallback",
    );
    expect(result.code).toBeUndefined();
    expect(result.message).not.toContain("SECRET_STAGE");
  });
  it.each([
    [
      "cookie-rejected",
      "Native browser rejected a retained cookie. Disable Restore saved cookies to start fresh without changing the saved snapshot, then reopen the connection.",
    ],
    [
      "cookie-restore-timeout",
      "Native browser cookie restoration timed out waiting for cookie storage. Retry or disable Restore saved cookies to start fresh without changing the saved snapshot.",
    ],
    [
      "cookie-restore-invalid",
      "Retained browser cookies do not match the current storage or origin rules. Disable Restore saved cookies to start fresh without changing the saved snapshot.",
    ],
  ])(
    "reports the fixed %s restore cause without arbitrary cookie data",
    (code, message) => {
      expect(runtime).toContain(JSON.stringify(message));
      expect(originBrowserStartupError("create", message)).toMatchObject({
        category: "runtime",
        code,
      });
      const decorated = originBrowserStartupError(
        "create",
        `${message} COOKIE_SECRET`,
      );
      expect(decorated.code).toBeUndefined();
      expect(decorated.message).not.toContain("COOKIE_SECRET");
    },
  );
  it("surfaces the exact native MFA origin mismatch with review/re-enable/save guidance", () => {
    expect(mfaOriginFailure).toBeTruthy();
    for (const error of [
      mfaOriginFailure,
      new Error(mfaOriginFailure),
      mfaOriginAuthenticationDisplay,
      new Error(mfaOriginAuthenticationDisplay),
    ]) {
      const result = originBrowserStartupError("create", error);
      expect(result).toEqual({
        stage: "create",
        category: "connection",
        code: "mfa-origin-mismatch",
        reason: "mfa-origin-mismatch",
        message: `Native browser startup failed (create). ${mfaOriginAuthenticationDisplay}`,
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
      `${mfaOriginAuthenticationDisplay} https://user:secret@example.test/?token=secret`,
      new Error(`${mfaOriginFailure}\nstack with SYNTHETIC-SEED`),
      new Error(`${mfaOriginAuthenticationDisplay}\nstack with SYNTHETIC-SEED`),
      { message: mfaOriginFailure },
      { message: mfaOriginAuthenticationDisplay },
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
      // Native's sentence is shown as it is, except where it stopped being
      // true: a start that timed out no longer needs an app restart.
      const shown =
        name === "STARTUP_TIMED_OUT"
          ? "The native browser engine took too long to become ready. A slow start does not disable it, so it may still be starting: use Retry browser. If it keeps timing out, check the native startup diagnostics."
          : message;
      expect(originBrowserStartupError("create", message)).toEqual({
        stage: "create",
        category: "runtime",
        code,
        message: `Native browser startup failed (create). ${shown}`,
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

  it("retries only the two native start failures that pass by themselves", () => {
    const retried = names
      .map(([name, code]) => {
        const message = runtime.match(
          new RegExp(`const ${name}: &str = "([^"]+)";`),
        )?.[1];
        expect(message).toBeTruthy();
        const failure = originBrowserStartupError("create", message);
        expect(failure.code).toBe(code);
        // The same text from another stage, or decorated, proves nothing.
        expect(
          originBrowserStartupRetryable(
            originBrowserStartupError("status", message),
          ),
        ).toBe(false);
        expect(
          originBrowserStartupRetryable(
            originBrowserStartupError("create", `${message} SECRET`),
          ),
        ).toBe(false);
        return originBrowserStartupRetryable(failure) ? name : null;
      })
      .filter(Boolean);
    expect(retried).toEqual(["PROXY_FAILED", "STARTUP_TIMED_OUT"]);
    for (const failure of [
      originBrowserStartupError("create", new Error("unrecognized")),
      originBrowserStartupError("owner-check", new Error("revoked")),
      originBrowserStartupError("create", mfaOriginFailure),
      originBrowserStartupError(
        "create",
        "A browser attempt already exists for this tab, or the native browser limit was reached.",
      ),
      originBrowserStartTimeout("create"),
    ])
      expect(originBrowserStartupRetryable(failure)).toBe(false);
  });

  it.each(["listen", "status", "owner-check", "create", "resync"] as const)(
    "reports the shell's own start deadline at %s with a fixed code and Retry",
    (stage) => {
      const failure = originBrowserStartTimeout(stage);
      expect(failure).toEqual({
        stage,
        category: "ipc",
        code: "start-timeout",
        message: expect.stringContaining(
          `Native browser startup failed (${stage}).`,
        ),
      });
      expect(failure.message).toContain("did not answer");
      expect(failure.message).toContain("Use Retry browser");
      // No native text can carry this code.
      expect(
        originBrowserStartupError(stage, failure.message).code,
      ).toBeUndefined();
    },
  );

  it("says how often a start was tried, after the unchanged failure text", () => {
    const { message } = originBrowserStartupError(
      "create",
      runtime.match(/const STARTUP_TIMED_OUT: &str = "([^"]+)";/)?.[1],
    );
    const text = originBrowserStartRetriesExhausted(message, 3);
    expect(text.startsWith(`${message} `)).toBe(true);
    expect(text).toContain("retried automatically");
    expect(text).toContain("after 3 attempts");
  });

  it("asks for an app restart only when the engine really failed, not when a start took too long", () => {
    const text = (name: string) =>
      runtime.match(new RegExp(`const ${name}: &str = "([^"]+)";`))![1];
    const slow = originBrowserStartupError("create", text("STARTUP_TIMED_OUT"));
    expect(slow.code).toBe("runtime-timeout");
    expect(slow.message).toContain("took too long");
    expect(slow.message).toContain("may still be starting");
    expect(slow.message).toContain("use Retry browser");
    expect(slow.message).not.toMatch(/restart the app/i);
    // Native's own sentence is unchanged and stays the match key.
    expect(text("STARTUP_TIMED_OUT")).toContain("restart the app");
    expect(
      originBrowserStartupError("create", `${text("STARTUP_TIMED_OUT")} `).code,
    ).toBeUndefined();
    const failed = originBrowserStartupError("create", text("STARTUP_FAILED"));
    expect(failed.code).toBe("runtime-readiness");
    expect(failed.message).toContain("restart the app");
  });

  it("recognizes a lease lost during the start only from the exact create answer", () => {
    const stale = runtime.match(/const STALE: &str = "([^"]+)";/)?.[1];
    expect(stale).toBeTruthy();
    const failure = originBrowserStartupError("create", stale);
    expect(failure.code).toBe("session-stale");
    expect(originBrowserStartupStale(failure)).toBe(true);
    // One fresh attempt, never the three of a failure that passes by itself.
    expect(originBrowserStartupRetryable(failure)).toBe(false);
    for (const other of [
      originBrowserStartupError("status", stale),
      originBrowserStartupError("resync", stale),
      originBrowserStartupError("owner-check", stale),
      originBrowserStartupError("create", `${stale} SECRET`),
      originBrowserStartupError("create", { message: stale }),
      originBrowserStartupError(
        "create",
        "Browser saved database owner is unavailable or changed",
      ),
      originBrowserStartupError(
        "create",
        "A browser attempt already exists for this tab, or the native browser limit was reached.",
      ),
      originBrowserStartTimeout("create"),
    ])
      expect(originBrowserStartupStale(other)).toBe(false);
  });

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
