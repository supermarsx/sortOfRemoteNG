import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HTTP_FORM_AUTOMATION,
  normalizeHttpFormAutomation,
} from "../../src/utils/connection/httpFormAutomation";
import type { HttpFormAutomation } from "../../src/types/connection/httpFormAutomation";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
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
