import { loadAutologinClient } from "../helpers/autologinAsset";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HTTP_FORM_AUTOMATION,
  normalizeHttpFormAutomation,
} from "../../src/utils/connection/httpFormAutomation";
import type { HttpFormAutomation } from "../../src/types/connection/httpFormAutomation";
import { browserFormAutomation } from "../../src/utils/protocol/browserCompatibility";

const source = loadAutologinClient();
type Result = { ok: boolean; reason: string };
type Client = {
  bootstrap(
    creds: { username: string | null; password: string | null },
    selectors: object,
    options?: unknown,
  ): Promise<Result>;
  cancel(): void;
};
let client: Client;
const selectors = { username: "#user", password: "#pass", submit: "#submit" };
const config = (
  patch: Partial<HttpFormAutomation> = {},
): HttpFormAutomation => ({
  ...DEFAULT_HTTP_FORM_AUTOMATION,
  fields: [],
  ...patch,
});
const creds = () => ({ username: "fixture-user", password: "fixture-secret" });
function show(html = "", method = 'method="post"') {
  document.body.innerHTML = `<form id="login" ${method}><input id="user" name="username"><input id="pass" type="password">${html}<button id="submit" type="submit">Login</button></form>`;
  for (const element of document.querySelectorAll("input,button,select"))
    Object.defineProperty(element, "offsetParent", {
      get: () => document.body,
    });
  const submit = vi.fn((event: Event) => event.preventDefault());
  document.querySelector("form")!.addEventListener("submit", submit);
  return submit;
}
const field = (id: string) => document.getElementById(id) as HTMLInputElement;

describe("strict advanced form settings", () => {
  it("preserves absence and copies bounded explicit fields", () => {
    expect(normalizeHttpFormAutomation(undefined)).toBeUndefined();
    const raw = config({
      formSelector: "#login",
      fields: [{ selector: "#tenant", value: "tenant-value" }],
    });
    expect(normalizeHttpFormAutomation(raw)).toEqual(raw);
    expect(normalizeHttpFormAutomation(raw)?.fields).not.toBe(raw.fields);
  });
  it.each([
    null,
    {},
    config({ version: 2 as 1 }),
    { ...config(), unknown: true },
    config({ fillDelayMs: 30001 }),
    config({ fillDelayMs: 8000, submitDelayMs: 1 }),
    config({ detectionTimeoutMs: 999 }),
    config({ formSelector: "[" }),
    config({
      fields: [
        { selector: "#x", value: "a" },
        { selector: "#x", value: "b" },
      ],
    }),
    config({ fields: [{ selector: "#x", value: "x".repeat(4097) }] }),
    config({ fields: [{ selector: "#x", value: "bad\0value" }] }),
    config({
      fields: Array.from({ length: 17 }, (_, i) => ({
        selector: `#x${i}`,
        value: "a",
      })),
    }),
    config({
      fields: Array.from({ length: 5 }, (_, i) => ({
        selector: `#x${i}`,
        value: "é".repeat(2000),
      })),
    }),
  ])(
    "rejects malformed/over-budget configuration without echoing data",
    (raw) => {
      expect(() => normalizeHttpFormAutomation(raw)).toThrow(
        "Invalid advanced form settings",
      );
    },
  );
});

describe("actual advanced form client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    window.eval(source);
    client = (window as unknown as { __sorng_autologin: Client })
      .__sorng_autologin;
  });
  afterEach(() => {
    client.cancel();
    window.removeEventListener("pagehide", client.cancel);
    window.removeEventListener("unload", client.cancel);
    Reflect.deleteProperty(window, "__sorng_autologin");
    Reflect.deleteProperty(window, "__autologin_last");
    Reflect.deleteProperty(document, "readyState");
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it("waits both configured delays and submits exactly once", async () => {
    const submit = show();
    const credentials = creds();
    const pending = client.bootstrap(
      credentials,
      selectors,
      config({ fillDelayMs: 300, submitDelayMs: 500 }),
    );
    await vi.advanceTimersByTimeAsync(299);
    expect(field("pass").value).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect(field("pass").value).toBe("fixture-secret");
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
    expect(credentials).toEqual({ username: null, password: null });
    await vi.advanceTimersByTimeAsync(60000);
    expect(submit).toHaveBeenCalledOnce();
  });
  describe("Escape from the user while the fill waits to submit", () => {
    // jsdom cannot mark an event trusted: hand the client's own document
    // listener the user's trusted Escape, as the engine delivers it.
    function keydownListeners() {
      const added = vi.spyOn(document, "addEventListener");
      const removed = vi.spyOn(document, "removeEventListener");
      const live = () =>
        added.mock.calls
          .filter(([type, , capture]) => type === "keydown" && capture === true)
          .map(([, listener]) => listener as (event: unknown) => void)
          .filter(
            (listener) =>
              !removed.mock.calls.some(
                ([type, other]) => type === "keydown" && other === listener,
              ),
          );
      const escape = (target: Element, props: object = {}) => {
        const event = {
          target,
          key: "Escape",
          isTrusted: true,
          prevented: false,
          stopped: false,
          preventDefault() {
            this.prevented = true;
          },
          stopImmediatePropagation() {
            this.stopped = true;
          },
          ...props,
        };
        for (const listener of live()) listener(event);
        return event;
      };
      return { live, escape };
    }
    function observe(...ids: string[]) {
      const seen: [string, string, string][] = [];
      for (const id of ids)
        for (const type of ["input", "change"])
          field(id).addEventListener(type, () =>
            seen.push([id, type, field(id).value]),
          );
      return seen;
    }
    it("cancels the run, erases what it filled with input and change events, and submits nothing", async () => {
      const submit = show();
      const keys = keydownListeners();
      const credentials = creds();
      const pending = client.bootstrap(
        credentials,
        selectors,
        config({ submitDelayMs: 500 }),
      );
      expect(field("pass").value).toBe("fixture-secret");
      const seen = observe("user", "pass");
      const event = keys.escape(field("pass"));
      expect(event.prevented).toBe(true);
      expect(event.stopped).toBe(true);
      expect(await pending).toEqual({ ok: false, reason: "cancelled" });
      expect(field("user").value).toBe("");
      expect(field("pass").value).toBe("");
      expect(field("pass").getAttribute("value")).toBeNull();
      expect(seen).toEqual([
        ["user", "input", ""],
        ["user", "change", ""],
        ["pass", "input", ""],
        ["pass", "change", ""],
      ]);
      expect(credentials).toEqual({ username: null, password: null });
      await vi.advanceTimersByTimeAsync(60000);
      expect(submit).not.toHaveBeenCalled();
      // The run is over: Escape is the page's again.
      expect(keys.live()).toEqual([]);
    });
    it("erases explicit extra fields it filled, never a value the user changed", async () => {
      const submit = show('<input id="tenant"><input id="site">');
      const keys = keydownListeners();
      const pending = client.bootstrap(
        creds(),
        selectors,
        config({
          submitDelayMs: 500,
          fields: [
            { selector: "#tenant", value: "team" },
            { selector: "#site", value: "hq" },
          ],
        }),
      );
      field("user").value = "typed-by-user";
      field("site").value = "site-by-user";
      keys.escape(field("tenant"));
      expect(await pending).toEqual({ ok: false, reason: "cancelled" });
      expect(field("tenant").value).toBe("");
      expect(field("site").value).toBe("site-by-user");
      expect(field("pass").value).toBe("");
      expect(field("user").value).toBe("typed-by-user");
      expect(submit).not.toHaveBeenCalled();
    });
    it.each([
      ["another control", { target: "submit" }],
      ["an untrusted event", { isTrusted: false }],
      ["a modified Escape", { ctrlKey: true }],
      ["another key", { key: "a" }],
    ])("leaves %s to the page and still submits once", async (_, props) => {
      const submit = show();
      const keys = keydownListeners();
      const pending = client.bootstrap(
        creds(),
        selectors,
        config({ submitDelayMs: 500 }),
      );
      const { target, ...rest } = props as { target?: string };
      const event = keys.escape(field(target ?? "pass"), rest);
      expect(event.prevented).toBe(false);
      expect(event.stopped).toBe(false);
      await vi.advanceTimersByTimeAsync(500);
      expect(await pending).toMatchObject({ reason: "submitted" });
      expect(submit).toHaveBeenCalledOnce();
      expect(field("pass").value).toBe("fixture-secret");
      expect(keys.live()).toEqual([]);
    });
    it("is not armed before anything was filled", async () => {
      show();
      const keys = keydownListeners();
      const pending = client.bootstrap(
        creds(),
        selectors,
        config({ fillDelayMs: 300 }),
      );
      expect(keys.live()).toEqual([]);
      expect(keys.escape(field("pass")).prevented).toBe(false);
      await vi.advanceTimersByTimeAsync(300);
      expect(await pending).toMatchObject({ reason: "submitted" });
    });
  });
  it("honors the largest combined browser delay and still submits before expiry", async () => {
    const submit = show();
    const pending = client.bootstrap(
      creds(),
      selectors,
      browserFormAutomation(undefined, false, 30000, 22000),
    );
    await vi.advanceTimersByTimeAsync(29999);
    expect(field("pass").value).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect(field("pass").value).toBe("fixture-secret");
    await vi.advanceTimersByTimeAsync(21999);
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(8000);
    expect(submit).toHaveBeenCalledOnce();
  });
  it("fills only explicit text, hidden and selected option values, preserving site CSRF", async () => {
    const submit = show(
      '<input id="tenant"><input id="domain" type="hidden"><input name="csrf_token" type="hidden" value="site-managed"><select id="region"><option value="a">A</option><option value="b">B</option></select>',
    );
    const result = await client.bootstrap(
      creds(),
      selectors,
      config({
        formSelector: "#login",
        submit: false,
        fields: [
          { selector: "#tenant", value: "team" },
          { selector: "#domain", value: "example" },
          { selector: "#region", value: "b" },
        ],
      }),
    );
    expect(result).toEqual({ ok: true, reason: "filled-only" });
    expect(submit).not.toHaveBeenCalled();
    expect(field("tenant").value).toBe("team");
    expect(field("domain").value).toBe("example");
    expect(field("region").value).toBe("b");
    expect(
      (document.querySelector('[name="csrf_token"]') as HTMLInputElement).value,
    ).toBe("site-managed");
  });
  it.each([
    '<input id="extra" type="password">',
    '<input id="extra" type="file">',
    '<input id="extra" type="hidden" name="csrf_token">',
    '<input id="extra" name="otp">',
    '<input id="extra" autocomplete="one-time-code">',
    '<select id="extra"><option disabled value="value">Disabled</option></select>',
    '<input id="extra" disabled>',
  ])(
    "rejects disallowed extra control %s before primary credentials",
    async (html) => {
      const submit = show(html);
      expect(
        await client.bootstrap(
          creds(),
          selectors,
          config({ fields: [{ selector: "#extra", value: "value" }] }),
        ),
      ).toMatchObject({ reason: "invalid-extra-field" });
      expect(field("pass").value).toBe("");
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it("refuses duplicate or outside-form explicit controls", async () => {
    show('<input class="extra"><input class="extra">');
    expect(
      await client.bootstrap(
        creds(),
        selectors,
        config({ fields: [{ selector: ".extra", value: "v" }] }),
      ),
    ).toMatchObject({ reason: "invalid-extra-field" });
    expect(field("pass").value).toBe("");
  });
  it("will not reacquire a replaced form during fill delay", async () => {
    show();
    const pending = client.bootstrap(
      creds(),
      selectors,
      config({ fillDelayMs: 500 }),
    );
    const submit = show();
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ reason: "form-changed-or-unsafe" });
    expect(field("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
  });
  it.each(["action", "field", "submit"])(
    "refuses changed %s before delayed submission",
    async (change) => {
      const submit = show();
      const pending = client.bootstrap(
        creds(),
        selectors,
        config({ submitDelayMs: 500 }),
      );
      if (change === "action")
        document.querySelector("form")!.setAttribute("action", "/different");
      if (change === "field") field("pass").name = "different";
      if (change === "submit")
        document
          .getElementById("submit")!
          .setAttribute("formaction", "https://other.test/");
      await vi.advanceTimersByTimeAsync(500);
      expect(await pending).toMatchObject({ reason: "form-changed-or-unsafe" });
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it("checks synchronous focus/input handlers before writing the next credential", async () => {
    const submit = show();
    field("user").addEventListener("input", () =>
      document
        .querySelector("form")!
        .setAttribute("action", "https://other.test/"),
    );
    expect(await client.bootstrap(creds(), selectors, config())).toMatchObject({
      reason: "form-changed-or-unsafe",
    });
    expect(field("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
  });
  it("does not write into a password changed to text by a focus handler", async () => {
    show();
    field("pass").addEventListener("focus", () => {
      field("pass").type = "text";
    });
    expect(await client.bootstrap(creds(), selectors, config())).toMatchObject({
      reason: "form-changed-or-unsafe",
    });
    expect(field("pass").value).toBe("");
  });
  it("cancels before delayed fill on navigation and clears private credentials", async () => {
    const submit = show();
    const credentials = creds();
    const pending = client.bootstrap(
      credentials,
      selectors,
      config({ fillDelayMs: 500 }),
    );
    window.dispatchEvent(new Event("pagehide"));
    expect(await pending).toMatchObject({ reason: "cancelled" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(field("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
    expect(credentials.password).toBeNull();
  });
  it("times out ambiguous explicit forms without fallback or credential fill", async () => {
    show();
    document.body.insertAdjacentHTML("beforeend", '<form id="second"></form>');
    const pending = client.bootstrap(
      creds(),
      selectors,
      config({ formSelector: "form", detectionTimeoutMs: 1000 }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ reason: "form-not-found-timeout" });
    expect(field("pass").value).toBe("");
  });
  it("preserves SPA handlers but prevents implicit native GET credential submission", async () => {
    show("", "");
    let prevented = false;
    document.querySelector("form")!.addEventListener("submit", (event) => {
      prevented = event.defaultPrevented;
    });
    expect(await client.bootstrap(creds(), selectors, config())).toMatchObject({
      reason: "submitted",
    });
    expect(prevented).toBe(true);
  });
  it.each([
    null,
    config({ fillDelayMs: 30001 }),
    config({ fields: [{ selector: "[", value: "fixture-secret" }] }),
  ])("refuses invalid options without mutation", async (options) => {
    show();
    expect(await client.bootstrap(creds(), selectors, options)).toMatchObject({
      reason: "invalid-form-options",
    });
    expect(field("pass").value).toBe("");
  });
});
