import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
let messages: ReturnType<typeof vi.spyOn>;
const install = (value = identity()) => {
  (window as unknown as { fixtureIdentity: unknown }).fixtureIdentity = value;
  window.eval(`(function(){var p=window.fixtureIdentity;${source}\n})();`);
};
const send = (detail: unknown) =>
  document.dispatchEvent(
    new CustomEvent("sorng_synology_login_progress", { detail }),
  );
beforeEach(() => {
  messages = vi.spyOn(window, "postMessage").mockImplementation(() => {});
});
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
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
  it("bounds noisy intermediate reports but always delivers the terminal result", () => {
    install();
    for (let index = 0; index < 100; index++)
      send({
        phase: "waiting_root",
        reason: index % 2 ? "root-missing" : "root-ambiguous",
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
});
