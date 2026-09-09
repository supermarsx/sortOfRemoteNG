import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
type Credentials = { username: string | null; password: string | null };
type Result = { ok: boolean; reason: string };
type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors?: object,
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

  it("retains the private copy for delayed SPA forms, then submits once and clears the transport object", async () => {
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await flush();
    expect(response).toEqual({ username: null, password: null });
    const submit = form();
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
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
    const pending = client.fetchCredsAndRun("fixture", selectors);
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    const submit = form();
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
      expect(submit).not.toHaveBeenCalled();
      expect(input("pass").value).toBe("");
    },
  );
  it("rejects invisible overrides, invalid CSS and external form actions without secrets in results", async () => {
    form('action="https://other.example.test/collect"');
    const pending = client.fetchCredsAndRun("fixture", selectors);
    expect(await pending).toMatchObject({ reason: "unsafe-form-action" });
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
    expect(malformed).toEqual({ username: null, password: null });
    expect(
      (dom.window as unknown as { __autologin_last: Result }).__autologin_last,
    ).toEqual({ ok: false, reason: "invalid-credential-response" });
    expect(submit).not.toHaveBeenCalled();
  });
  it("does not retry a spent nonce after a non-200 response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await client.fetchCredsAndRun("fixture", selectors);
    client.fetchCredsAndRun("again", selectors);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      (dom.window as unknown as { __autologin_last: Result }).__autologin_last,
    ).toEqual({ ok: false, reason: "cred-fetch-failed" });
  });
});
