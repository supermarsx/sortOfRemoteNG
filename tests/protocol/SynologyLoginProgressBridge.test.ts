import { readFileSync } from "node:fs";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/synology_login_progress_client.js",
  "utf8",
);
const identity = () => ({
  sessionId: "proxy-a",
  documentToken: "a".repeat(32),
  documentSequence: 2,
  navigationToken: "b".repeat(32),
});
let messages: MockInstance<(message: unknown, targetOrigin: string) => void>;
const install = (value = identity()) => {
  (window as unknown as { fixtureIdentity: unknown }).fixtureIdentity = value;
  window.eval(`(function(){var p=window.fixtureIdentity;${source}\n})();`);
};
const send = (detail: unknown) =>
  document.dispatchEvent(
    new CustomEvent("sorng_synology_login_progress", { detail }),
  );
const close = () => window.dispatchEvent(new Event("pagehide"));
const posted = () =>
  messages.mock.calls.map(([message]) => message as Record<string, unknown>);
const fingerprint = (overrides: Record<string, unknown> = {}) => ({
  root: 1,
  panel: 1,
  form: 1,
  field: 1,
  button: 1,
  hash: "signin",
  readyState: "complete",
  stage: "account",
  ...overrides,
});
beforeEach(() => {
  messages = vi.spyOn(window, "postMessage").mockImplementation(() => {});
});
afterEach(() => {
  close();
  Reflect.deleteProperty(window, "__sorng_synology_login");
  Reflect.deleteProperty(window, "fixtureIdentity");
  vi.restoreAllMocks();
});

describe("actual native-included DSM progress bridge", () => {
  it("forwards bounded readiness and transition reasons without page-owned extra data", () => {
    install();
    for (const [phase, reason] of [
      ["waiting_account_stable", "form-settling"],
      ["waiting_next_button", "input-settling"],
      ["timeout", "next-not-advanced"],
    ]) {
      send({
        phase,
        reason,
        inputValue: "private",
        href: "https://private.invalid",
      });
      expect(messages.mock.lastCall?.[0]).toEqual({
        type: "proxy_synology_login_progress",
        version: 1,
        ...identity(),
        phase,
        reason,
      });
    }
    expect(messages).toHaveBeenCalledTimes(3);
  });
  it("copies only fixed diagnostics and the original native document identity", () => {
    const bound = identity();
    install(bound);
    bound.sessionId = "replacement";
    send({
      phase: "waiting_account_form",
      reason: "button-missing",
      username: "private",
      url: "https://private.invalid/?secret=hidden",
      documentToken: "forged",
    });
    expect(messages).toHaveBeenCalledExactlyOnceWith(
      {
        type: "proxy_synology_login_progress",
        version: 1,
        ...identity(),
        phase: "waiting_account_form",
        reason: "button-missing",
      },
      "*",
    );
    expect(JSON.stringify(messages.mock.calls)).not.toMatch(
      /private|secret|forged|replacement/,
    );
  });
  it("ignores unknown or coercible values, duplicate progress and later reports after terminal completion", () => {
    install();
    for (const detail of [
      null,
      "private",
      { phase: "unknown", reason: "timeout" },
      { phase: "timeout", reason: { toString: () => "timeout" } },
      { phase: "waiting_page", reason: "private-reason" },
      { phase: "__proto__", reason: "route-pending" },
      { phase: "waiting_page", reason: "observation-limited" },
    ])
      send(detail);
    expect(messages).not.toHaveBeenCalled();
    send({ phase: "waiting_root", reason: "root-missing" });
    send({ phase: "waiting_root", reason: "root-missing" });
    send({ phase: "waiting_account_form", reason: "form-missing" });
    send({ phase: "waiting_root", reason: "root-missing" });
    send({ phase: "timeout", reason: "timeout" });
    send({ phase: "requesting_password", reason: "requesting-password" });
    expect(messages).toHaveBeenCalledTimes(4);
  });
  it.each([
    ["waiting_page", "route-pending"],
    ["waiting_page", "page-busy"],
    ["waiting_account_stable", "panel-quiet-wait"],
    ["filling_username", "value-refilled"],
    ["waiting_next_button", "next-reclicked"],
    ["waiting_account_form", "controls-replaced"],
    ["filling_password", "value-refilled"],
    ["verifying_sign_in", "submitted"],
  ])("forwards the non-terminal %s/%s and keeps listening", (phase, reason) => {
    install();
    send({ phase, reason });
    send({ phase: "waiting_root", reason: "root-missing" });
    expect(posted().map((message) => [message.phase, message.reason])).toEqual([
      [phase, reason],
      ["waiting_root", "root-missing"],
    ]);
  });
  it.each([
    ["stopped", "captcha-required"],
    ["stopped", "interactive-step-required"],
    ["stopped", "user-input-detected"],
    ["stopped", "unsafe-form-target"],
    ["stopped", "account-mismatch"],
    ["stopped", "left-login-page"],
    ["stopped", "layout-unrecognized"],
    ["stopped", "unsupported-login-path"],
    ["timeout", "page-never-ready"],
    ["timeout", "login-form-never-appeared"],
    ["timeout", "password-panel-never-appeared"],
    ["timeout", "signin-button-never-enabled"],
    ["signed_in", "left-signin-page"],
    ["signed_in", "no-sign-in-page"],
    ["rejected", "error-visible"],
    ["submitted", "sign-in-unconfirmed"],
    ["cancelled", "cancelled"],
  ])("treats %s/%s as terminal", (phase, reason) => {
    install();
    send({ phase, reason });
    send({ phase: "waiting_root", reason: "root-missing" });
    send({ phase: "stopped", reason: "stopped" });
    expect(messages).toHaveBeenCalledOnce();
    expect(messages.mock.lastCall?.[0]).toMatchObject({ phase, reason });
  });
  it("bounds noisy phase changes but always delivers the terminal result", () => {
    install();
    for (let index = 0; index < 100; index++)
      send({
        phase: index % 2 ? "waiting_root" : "waiting_account_form",
        reason: "root-missing",
      });
    expect(messages).toHaveBeenCalledTimes(65);
    expect(messages.mock.lastCall?.[0]).toMatchObject({
      reason: "observation-limited",
    });
    send({ phase: "timeout", reason: "timeout" });
    expect(messages).toHaveBeenCalledTimes(66);
    expect(messages.mock.lastCall?.[0]).toMatchObject({
      phase: "timeout",
      reason: "timeout",
    });
  });
  it("gives reason-only changes within one phase a separate larger bound", () => {
    install();
    for (let index = 0; index < 400; index++)
      send({
        phase: "waiting_page",
        reason: index % 2 ? "route-pending" : "page-busy",
      });
    // One phase change, 256 reason-only changes, then one limit notice.
    expect(messages).toHaveBeenCalledTimes(258);
    expect(messages.mock.lastCall?.[0]).toMatchObject({
      phase: "waiting_page",
      reason: "observation-limited",
    });
    send({ phase: "waiting_root", reason: "root-missing" });
    expect(messages).toHaveBeenCalledTimes(258);
    send({ phase: "stopped", reason: "layout-unrecognized" });
    expect(messages).toHaveBeenCalledTimes(259);
  });
  it("does not let reason-only churn consume the phase-change bound", () => {
    install();
    for (let index = 0; index < 200; index++)
      send({
        phase: "waiting_page",
        reason: index % 2 ? "route-pending" : "page-busy",
      });
    for (let index = 0; index < 63; index++)
      send({
        phase: index % 2 ? "waiting_page" : "waiting_root",
        reason: "route-pending",
      });
    expect(posted().map((message) => message.reason)).not.toContain(
      "observation-limited",
    );
  });
  it.each(["pagehide", "unload"])(
    "removes the source-document listener on %s",
    (event) => {
      install();
      window.dispatchEvent(new Event(event));
      send({ phase: "waiting_root", reason: "root-missing" });
      expect(messages).not.toHaveBeenCalled();
    },
  );
  it("reads an already-installed fixed status snapshot without starting the helper", () => {
    const getStatus = vi.fn(() => ({
      phase: "waiting_root",
      reason: "root-missing",
    }));
    const run = vi.fn();
    Object.assign(window, { __sorng_synology_login: { getStatus, run } });
    install();
    expect(getStatus).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    expect(messages).toHaveBeenCalledOnce();
  });
  it("is installed through production readiness after the primary document announcement", () => {
    const native = readFileSync(
      "src-tauri/crates/sorng-protocols/src/http_response.rs",
      "utf8",
    );
    expect(native).toContain(
      'synology_progress_client = include_str!("synology_login_progress_client.js")',
    );
    expect(native.indexOf("emit('proxy_document_start');")).toBeLessThan(
      native.indexOf("{synology_progress_client}"),
    );
  });
  it("stays embeddable in an inline script element", () => {
    expect(source).not.toMatch(/<\/script|<!--/i);
  });
});

describe("closed page-helper trace forwarding", () => {
  const trace = (overrides: Record<string, unknown> = {}) => ({
    steps: [],
    fingerprint: fingerprint(),
    handoff: null,
    ...overrides,
  });

  it("forwards the last eight closed steps, the fingerprint and the hand-off", () => {
    const steps = Array.from({ length: 12 }, (_, index) => ({
      t: index * 100,
      phase: index % 2 ? "waiting_page" : "waiting_root",
      reason: index % 2 ? "route-pending" : "root-missing",
    }));
    install();
    send({
      phase: "stopped",
      reason: "interactive-step-required",
      trace: trace({
        steps,
        fingerprint: fingerprint({ hash: "otp", stage: "submitted" }),
        handoff: "otp",
      }),
    });
    expect(messages.mock.lastCall?.[0]).toEqual({
      type: "proxy_synology_login_progress",
      version: 1,
      ...identity(),
      phase: "stopped",
      reason: "interactive-step-required",
      trace: {
        steps: steps.slice(-8),
        fingerprint: fingerprint({ hash: "otp", stage: "submitted" }),
        handoff: "otp",
      },
    });
  });
  it.each([
    ["otp", "otp"],
    ["approve", "approve"],
    ["select-auth", "select-auth"],
    ["passkey", "passkey"],
    ["other", "other"],
  ])("accepts the closed hash %s with hand-off %s", (hash, handoff) => {
    install();
    send({
      phase: "stopped",
      reason: "interactive-step-required",
      trace: trace({ fingerprint: fingerprint({ hash }), handoff }),
    });
    expect(posted()[0].trace).toEqual({
      fingerprint: fingerprint({ hash }),
      handoff,
    });
  });
  it.each(["account", "password", "submitted"])(
    "accepts the closed stage %s",
    (stage) => {
      install();
      send({
        phase: "waiting_page",
        reason: "route-pending",
        trace: { fingerprint: { stage } },
      });
      expect(posted()[0].trace).toEqual({ fingerprint: { stage } });
    },
  );
  it("drops values outside the closed trace vocabulary and every page-owned extra field", () => {
    install();
    send({
      phase: "waiting_page",
      reason: "route-pending",
      trace: {
        url: "https://private.invalid/?token=PRIVATE_TOKEN",
        steps: [
          { t: -1, phase: "waiting_root", reason: "root-missing" },
          { t: 1.5, phase: "waiting_root", reason: "root-missing" },
          { t: "7", phase: "waiting_root", reason: "root-missing" },
          { t: 9, phase: "private_phase", reason: "root-missing" },
          { t: 9, phase: "waiting_root", reason: "PRIVATE_REASON" },
          { t: 9, phase: "waiting_root", reason: "observation-limited" },
          "PRIVATE_STEP",
          { t: 5, phase: "waiting_root", reason: "root-missing", value: "x" },
        ],
        fingerprint: {
          root: 2,
          panel: -1,
          form: 1.5,
          field: "1",
          button: 40,
          hash: "#/signin/PRIVATE_ROUTE",
          readyState: "private",
          stage: "PRIVATE_STAGE",
          username: "PRIVATE_USER",
        },
        handoff: "PRIVATE_HANDOFF",
      },
    });
    expect(posted()[0].trace).toEqual({
      steps: [{ t: 5, phase: "waiting_root", reason: "root-missing" }],
      fingerprint: { root: 2, button: 9 },
    });
    expect(JSON.stringify(messages.mock.calls)).not.toMatch(
      /PRIVATE|private|token|username|value/,
    );
  });
  it("omits a malformed, empty or throwing trace instead of dropping the closed phase", () => {
    install();
    const hostile = {};
    Object.defineProperty(hostile, "steps", {
      get() {
        throw new Error("PRIVATE_GETTER");
      },
    });
    const traces: unknown[] = [
      "PRIVATE",
      [],
      {},
      { steps: "PRIVATE", fingerprint: null, handoff: 7 },
      { steps: [], fingerprint: {}, handoff: null },
      hostile,
    ];
    traces.forEach((value, index) =>
      send({
        phase: index % 2 ? "waiting_page" : "waiting_root",
        reason: "route-pending",
        trace: value,
      }),
    );
    const detail = { phase: "waiting_account_form", reason: "form-missing" };
    Object.defineProperty(detail, "trace", {
      get() {
        throw new Error("PRIVATE_DETAIL_GETTER");
      },
    });
    send(detail);
    expect(messages).toHaveBeenCalledTimes(traces.length + 1);
    for (const message of posted())
      expect(Object.keys(message)).not.toContain("trace");
    expect(JSON.stringify(messages.mock.calls)).not.toContain("PRIVATE");
  });
  it("bounds hostile step arrays without iterating page-controlled lengths", () => {
    install();
    const steps: unknown[] = [];
    steps.length = 2 ** 31;
    steps[2 ** 31 - 1] = { t: 1, phase: "waiting_page", reason: "page-busy" };
    send({ phase: "waiting_page", reason: "route-pending", trace: { steps } });
    expect(posted()[0].trace).toEqual({
      steps: [{ t: 1, phase: "waiting_page", reason: "page-busy" }],
    });
  });
  it("deduplicates on phase and reason, so trace-only changes send nothing", () => {
    install();
    send({
      phase: "waiting_page",
      reason: "route-pending",
      trace: { fingerprint: fingerprint({ hash: "empty" }) },
    });
    send({
      phase: "waiting_page",
      reason: "route-pending",
      trace: { fingerprint: fingerprint({ hash: "slash" }) },
    });
    expect(messages).toHaveBeenCalledOnce();
  });
  it("sends no trace with the limit notice but keeps it on the terminal result", () => {
    install();
    for (let index = 0; index < 70; index++)
      send({
        phase: index % 2 ? "waiting_root" : "waiting_page",
        reason: "route-pending",
        trace: { fingerprint: { hash: "slash" } },
      });
    expect(messages.mock.lastCall?.[0]).toMatchObject({
      reason: "observation-limited",
    });
    expect(Object.keys(messages.mock.lastCall?.[0] as object)).not.toContain(
      "trace",
    );
    send({
      phase: "timeout",
      reason: "page-never-ready",
      trace: { fingerprint: { hash: "slash" } },
    });
    expect(messages.mock.lastCall?.[0]).toMatchObject({
      phase: "timeout",
      trace: { fingerprint: { hash: "slash" } },
    });
  });
  it("reads an already-installed helper's trace through getTrace, since getStatus has none", () => {
    const getTrace = vi.fn(() =>
      trace({
        steps: [{ t: 0, phase: "waiting_document", reason: "not-started" }],
        fingerprint: fingerprint({ hash: "slash", readyState: "loading" }),
      }),
    );
    Object.assign(window, {
      __sorng_synology_login: {
        getStatus: () => ({ phase: "waiting_page", reason: "route-pending" }),
        getTrace,
      },
    });
    install();
    expect(getTrace).toHaveBeenCalledOnce();
    expect(posted()[0].trace).toEqual({
      steps: [{ t: 0, phase: "waiting_document", reason: "not-started" }],
      fingerprint: fingerprint({ hash: "slash", readyState: "loading" }),
    });
  });
  it("still forwards an installed snapshot from a helper without getTrace", () => {
    Object.assign(window, {
      __sorng_synology_login: {
        getStatus: () => ({ phase: "waiting_page", reason: "route-pending" }),
      },
    });
    install();
    expect(posted()).toHaveLength(1);
    expect(Object.keys(posted()[0])).not.toContain("trace");
  });
});
