import { loadAutologinClient } from "../helpers/autologinAsset";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = loadAutologinClient();
type Credentials = { username: string | null; password: string | null };
type Result = { ok: boolean; reason: string };
type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors?: object,
    loginFlow?: string | null,
    readiness?: unknown,
  ): Promise<Result | undefined>;
  bootstrap(creds: Credentials, selectors?: object): Promise<Result>;
  cancel(): void;
};
const dom = { window };
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
let response: Credentials;
const selectors = {
  username_selector: "#user",
  password_selector: "#pass",
  submit_selector: "#submit",
};

function form(attributes = "") {
  dom.window.document.body.innerHTML = `<form ${attributes}><input id="user" name="username"><input id="pass" type="password"><button id="submit" type="submit">Login</button></form>`;
  for (const element of dom.window.document.querySelectorAll("input,button")) {
    Object.defineProperty(element, "offsetParent", {
      get: () => dom.window.document.body,
    });
  }
  const submit = vi.fn((event: Event) => event.preventDefault());
  dom.window.document.querySelector("form")!.addEventListener("submit", submit);
  return submit;
}
function input(id: string) {
  return dom.window.document.getElementById(id) as HTMLInputElement;
}
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("actual injected auto-login client lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(dom.window.document, "readyState", {
      configurable: true,
      value: "complete",
    });
    response = { username: "fixture-admin", password: "fixture-secret" };
    fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal("fetch", fetchMock);
    dom.window.eval(source);
    client = (dom.window as unknown as { __sorng_autologin: Client })
      .__sorng_autologin;
  });
  afterEach(() => {
    client.cancel();
    for (const app of [
      "bitwarden",
      "synology",
      "google",
      "cloudflare",
      "yealink",
    ])
      Reflect.deleteProperty(window, `__sorng_${app}_login`);
    window.removeEventListener("pagehide", client.cancel);
    window.removeEventListener("unload", client.cancel);
    Reflect.deleteProperty(window, "__sorng_autologin");
    Reflect.deleteProperty(window, "__autologin_last");
    Reflect.deleteProperty(document, "readyState");
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits for selected SPA controls before redeeming credentials, then submits once and clears the transport object", async () => {
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    const submit = form();
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(response).toEqual({
      username: null,
      password: null,
      continuation: null,
    });
    expect(input("user").value).toBe("fixture-admin");
    expect(input("pass").value).toBe("fixture-secret");
    expect(submit).toHaveBeenCalledOnce();
    client.fetchCredsAndRun("second-nonce", selectors);
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/__sortofremoteng_autologin?nonce=fixture-nonce",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  });
  it("clears private credentials on detection timeout, even before DOMContentLoaded", async () => {
    Object.defineProperty(dom.window.document, "readyState", {
      configurable: true,
      value: "loading",
    });
    const privateCopy: Credentials = {
      username: "fixture-admin",
      password: "fixture-secret",
    };
    const pending = client.bootstrap(privateCopy);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ reason: "form-not-found-timeout" });
    expect(privateCopy).toEqual({ username: null, password: null });
    const submit = form();
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
    await vi.advanceTimersByTimeAsync(9000);
    expect(submit).not.toHaveBeenCalled();
    expect(input("pass").value).toBe("");
  });
  it("owns credentials through DOMContentLoaded and clears them immediately after submission", async () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
    const privateCopy: Credentials = {
      username: "fixture-admin",
      password: "fixture-secret",
    };
    const pending = client.bootstrap(privateCopy, {
      username: "#user",
      password: "#pass",
      submit: "#submit",
    });
    const submit = form();
    expect(input("pass").value).toBe("");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(await pending).toMatchObject({ reason: "submitted" });
    expect(input("pass").value).toBe("fixture-secret");
    expect(privateCopy).toEqual({ username: null, password: null });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(submit).toHaveBeenCalledOnce();
  });
  it("does not consume a nonce when cancelled before bootstrap starts", () => {
    client.cancel();
    client.fetchCredsAndRun("fixture", selectors);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["cancel", "pagehide", "unload"])(
    "clears pending credentials and retries on %s",
    async (event) => {
      const privateCopy: Credentials = {
        username: "fixture-admin",
        password: "fixture-secret",
      };
      const pending = client.bootstrap(privateCopy);
      if (event === "cancel") client.cancel();
      else dom.window.dispatchEvent(new dom.window.Event(event));
      expect(await pending).toMatchObject({ reason: "cancelled" });
      expect(privateCopy).toEqual({ username: null, password: null });
      const submit = form();
      await vi.advanceTimersByTimeAsync(9000);
      expect(submit).not.toHaveBeenCalled();
      expect(input("pass").value).toBe("");
    },
  );
  it("does not fill when a credential response arrives after pagehide", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const submit = form();
    const pending = client.fetchCredsAndRun("fixture", selectors);
    await flush();
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    resolve({ ok: true, json: async () => response });
    await pending;
    expect(response.password).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
  it.each(["username_selector", "password_selector", "submit_selector"])(
    "does not fill or fall back when explicit %s is missing",
    async (field) => {
      const submit = form();
      const pending = client.fetchCredsAndRun("fixture", {
        ...selectors,
        [field]: "#missing",
      });
      await vi.advanceTimersByTimeAsync(8000);
      expect(await pending).toMatchObject({ reason: "form-not-found-timeout" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(input("pass").value).toBe("");
    },
  );
  it("rejects invisible overrides, invalid CSS and external form actions without secrets in results", async () => {
    form('action="https://other.example.test/collect"');
    const pending = client.fetchCredsAndRun("fixture", selectors);
    expect(await pending).toMatchObject({ reason: "unsafe-form-action" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input("pass").value).toBe("");
    expect(
      JSON.stringify(
        (dom.window as unknown as { __autologin_last: Result })
          .__autologin_last,
      ),
    ).not.toContain("fixture-secret");
    const privateCopy: Credentials = {
      username: "fixture-admin",
      password: "fixture-secret",
    };
    expect(
      await client.bootstrap(privateCopy, { password: "[" }),
    ).toMatchObject({ reason: "form-fill-failed" });
    expect(privateCopy.password).toBeNull();
    input("pass").style.display = "none";
    const hidden = client.bootstrap(
      { username: "u", password: "p" },
      { password: "#pass" },
    );
    await vi.advanceTimersByTimeAsync(8000);
    expect(await hidden).toMatchObject({ reason: "form-not-found-timeout" });
  });
  it("sanitizes failed/malformed responses and never retries the nonce", async () => {
    form();
    fetchMock.mockRejectedValue(new Error("fixture-secret"));
    await client.fetchCredsAndRun("fixture", selectors);
    client.fetchCredsAndRun("again", selectors);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      (dom.window as unknown as { __autologin_last: Result }).__autologin_last,
    ).toEqual({ ok: false, reason: "cred-fetch-failed" });
  });
  it("rejects a generic submit button's external formaction before filling anything", async () => {
    const submit = form();
    dom.window.document
      .querySelector("button")!
      .setAttribute("formaction", "https://other.example.test/collect");
    expect(await client.fetchCredsAndRun("fixture")).toMatchObject({
      reason: "unsafe-form-action",
    });
    expect(input("user").value).toBe("");
    expect(input("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
  });
  it("rejects a username selector targeting a different form", async () => {
    const submit = form();
    dom.window.document.body.insertAdjacentHTML(
      "beforeend",
      '<form><input id="other"></form>',
    );
    Object.defineProperty(input("other"), "offsetParent", {
      get: () => dom.window.document.body,
    });
    const pending = client.fetchCredsAndRun("fixture", {
      ...selectors,
      username_selector: "#other",
    });
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ reason: "form-not-found-timeout" });
    expect(input("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
  });
  it("clears malformed credential data and reports only a fixed failure reason", async () => {
    const malformed = { username: "fixture-admin", password: 17 };
    fetchMock.mockResolvedValue({ ok: true, json: async () => malformed });
    const submit = form();
    await client.fetchCredsAndRun("fixture", selectors);
    expect(malformed).toEqual({
      username: null,
      password: null,
      continuation: null,
    });
    expect(
      (dom.window as unknown as { __autologin_last: Result }).__autologin_last,
    ).toEqual({ ok: false, reason: "invalid-credential-response" });
    expect(submit).not.toHaveBeenCalled();
  });
  it("does not redeem a selected-form grant while the document is still loading", async () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
    const submit = form();
    const pending = client.fetchCredsAndRun("fixture", selectors);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ reason: "form-not-found-timeout" });
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it("honors a longer configured readiness timeout and form selector before consuming the grant", async () => {
    const pending = client.fetchCredsAndRun("fixture", selectors, null, {
      detectionTimeoutMs: 30000,
      formSelector: "form#selected",
    });
    const submit = form();
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock).not.toHaveBeenCalled();
    document.querySelector("form")!.id = "selected";
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toMatchObject({ reason: "submitted" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
  });
  it.each([
    null,
    { detectionTimeoutMs: 60001 },
    { detectionTimeoutMs: 8000, fields: [{ selector: "#x", value: "secret" }] },
    { detectionTimeoutMs: 8000, formSelector: "[" },
  ])(
    "rejects invalid public readiness %j without requesting credentials",
    async (readiness) => {
      form();
      expect(
        await client.fetchCredsAndRun("fixture", selectors, null, readiness),
      ).toMatchObject({
        reason: "invalid-form-options",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("shares one timeout across form readiness and delayed filling", async () => {
    Object.assign(response, {
      formAutomation: {
        version: 1,
        detectionTimeoutMs: 1000,
        fillDelayMs: 500,
        submitDelayMs: 0,
        submit: true,
        fields: [],
      },
    });
    const pending = client.fetchCredsAndRun("fixture", selectors, null, {
      detectionTimeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(600);
    const submit = form();
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toMatchObject({ reason: "form-not-found-timeout" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(input("user").value).toBe("");
    expect(input("pass").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
    expect(response.password).toBeNull();
  });
  it("does not consume credentials when controls appear at the deadline", async () => {
    const pending = client.fetchCredsAndRun("fixture", selectors, null, {
      detectionTimeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(999);
    const submit = form();
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ reason: "form-not-found-timeout" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it("discards credentials returned after the readiness deadline without filling", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const submit = form();
    const pending = client.fetchCredsAndRun("fixture", selectors, null, {
      detectionTimeoutMs: 1000,
    });
    await flush();
    await vi.advanceTimersByTimeAsync(1200);
    resolve({ ok: true, json: async () => response });
    await flush();
    expect(await pending).toMatchObject({ reason: "form-not-found-timeout" });
    expect(input("user").value).toBe("");
    expect(input("pass").value).toBe("");
    expect(response.password).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });
  it.each([
    "unknown",
    "",
    "google",
    "google-password",
    "cloudflare",
    "yealink-t20p",
    "cpanel",
    7,
    {},
    [],
  ])(
    "rejects unreviewed response flow %j without filling or leaking transport secrets",
    async (loginFlow) => {
      const submit = form();
      const fields = [{ value: "fixture-extra-secret" }];
      Object.assign(response, {
        loginFlow,
        continuation: "fixture-token",
        formAutomation: { fields },
      });
      await client.fetchCredsAndRun("fixture", selectors);
      expect(Reflect.get(window, "__autologin_last")).toEqual({
        ok: false,
        reason: "invalid-login-flow",
      });
      expect(input("user").value).toBe("");
      expect(input("pass").value).toBe("");
      expect(submit).not.toHaveBeenCalled();
      expect(response).toMatchObject({
        username: null,
        password: null,
        continuation: null,
      });
      expect(fields[0].value).toBe("");
      client.fetchCredsAndRun("again", selectors);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );
  it.each(["bitwarden", "synology", "google", "cpanel", "unknown"])(
    "rejects response flow %s for the cPanel generic-credential contract",
    async (loginFlow) => {
      const submit = form();
      const run = vi.fn();
      Reflect.set(window, `__sorng_${loginFlow}_login`, {
        run,
        cancel: vi.fn(),
      });
      Object.assign(response, { loginFlow });
      await client.fetchCredsAndRun("fixture", selectors, "cpanel");
      expect(Reflect.get(window, "__autologin_last")).toMatchObject({
        reason: "invalid-login-flow",
      });
      expect(run).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      expect(input("pass").value).toBe("");
      expect(response.password).toBeNull();
      Reflect.deleteProperty(window, `__sorng_${loginFlow}_login`);
    },
  );
  it.each(
    ["bitwarden", "synology"].flatMap((flow) => [
      { flow, missing: true },
      { flow, missing: false },
    ]),
  )(
    "rejects missing legacy response adapter $flow (absent=$missing)",
    async ({ flow, missing }) => {
      const submit = form();
      if (!missing)
        Reflect.set(window, `__sorng_${flow}_login`, { cancel: vi.fn() });
      Object.assign(response, { loginFlow: flow });
      await client.fetchCredsAndRun("fixture");
      expect(Reflect.get(window, "__autologin_last")).toMatchObject({
        reason: "autologin-client-unavailable",
      });
      expect(submit).not.toHaveBeenCalled();
      expect(input("pass").value).toBe("");
      expect(response.password).toBeNull();
    },
  );
  it.each(["bitwarden", "synology"])(
    "preserves reviewed legacy %s dispatch without a hint",
    async (flow) => {
      const submit = form();
      const received = vi.fn();
      const run = vi.fn((data: Credentials) => received(data.username));
      Reflect.set(window, `__sorng_${flow}_login`, { run, cancel: vi.fn() });
      Object.assign(response, { loginFlow: flow });
      await client.fetchCredsAndRun("fixture");
      expect(run).toHaveBeenCalledOnce();
      expect(received).toHaveBeenCalledWith("fixture-admin");
      expect(response.password).toBeNull();
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it.each(
    [
      "synology",
      "google",
      "google-password",
      "cloudflare",
      "yealink-t20p",
    ].flatMap((flow) => [
      { flow, missing: true },
      { flow, missing: false },
    ]),
  )(
    "rejects missing injected adapter $flow before nonce redemption (absent=$missing)",
    async ({ flow, missing }) => {
      const app =
        flow === "yealink-t20p"
          ? "yealink"
          : flow === "google-password"
            ? "google"
            : flow;
      if (!missing)
        Reflect.set(window, `__sorng_${app}_login`, { cancel: vi.fn() });
      await client.fetchCredsAndRun("fixture", selectors, flow);
      expect(Reflect.get(window, "__autologin_last")).toMatchObject({
        reason: "autologin-client-unavailable",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each(["unknown", "", "bitwarden", "__proto__"])(
    "rejects unknown injected flow %s before nonce redemption",
    async (flow) => {
      await client.fetchCredsAndRun("fixture", selectors, flow);
      expect(Reflect.get(window, "__autologin_last")).toMatchObject({
        reason: "invalid-login-flow",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it("does not retry a spent nonce after a non-200 response", async () => {
    form();
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await client.fetchCredsAndRun("fixture", selectors);
    client.fetchCredsAndRun("again", selectors);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      (dom.window as unknown as { __autologin_last: Result }).__autologin_last,
    ).toEqual({ ok: false, reason: "cred-fetch-failed" });
  });
});
