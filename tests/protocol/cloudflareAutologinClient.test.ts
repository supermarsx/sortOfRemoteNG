import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/cloudflare_autologin_client.js",
  "utf8",
);
const primary = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
type Client = {
  fetchCredsAndRun(nonce: string, selectors: undefined, flow: string): void;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
const email = "person@example.test";
const password = "fixture-only-password";
const form =
  '<form><input type="email" name="email" autocomplete="username"><input type="password" name="password" autocomplete="current-password"><button type="submit">Log in</button></form>';

function install(html = form, path = "/login") {
  history.replaceState({}, "", path);
  document.body.innerHTML = html;
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  Reflect.deleteProperty(window, "__sorng_cloudflare_login");
  Reflect.deleteProperty(window, "__sorng_autologin");
  window.eval(`${source}\n${primary}`);
  client = (window as unknown as { __sorng_autologin: Client })
    .__sorng_autologin;
}
function start(nonce = "b".repeat(32)) {
  client.fetchCredsAndRun(nonce, undefined, "cloudflare");
}
function replies() {
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes("phase=password")
        ? { loginFlow: "cloudflare", password }
        : {
            loginFlow: "cloudflare",
            username: email,
            continuation: "a".repeat(32),
          },
  }));
}
const input = (type: string) =>
  document.querySelector<HTMLInputElement>(`input[type="${type}"]`)!;

describe("Cloudflare dashboard auto-login adapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    client?.cancel();
    window.dispatchEvent(new Event("pagehide"));
    Reflect.deleteProperty(window, "__sorng_cloudflare_login");
    Reflect.deleteProperty(window, "__sorng_autologin");
    Reflect.deleteProperty(window, "__autologin_last");
    Reflect.deleteProperty(window, "_cf_chl_opt");
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("settles the combined React form, fills each stage once, then clicks its button", async () => {
    install();
    replies();
    const button = document.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    let modelPassword = "";
    input("password").addEventListener("input", () =>
      setTimeout(() => {
        modelPassword = input("password").value;
        button.disabled = false;
      }, 50),
    );
    const submit = vi.fn((event: SubmitEvent) => {
      expect(event.defaultPrevented).toBe(true);
      expect(modelPassword).toBe(password);
    });
    document.querySelector("form")!.addEventListener("submit", submit);
    start();
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2001);
    expect(input("email").value).toBe(email);
    expect(input("password").value).toBe(password);
    expect(submit).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(
      `/__sortofremoteng_autologin?phase=password&nonce=${"a".repeat(32)}`,
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(submit).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("continues after asynchronous email-to-password panel replacement", async () => {
    install(
      form.replace(
        '<input type="password" name="password" autocomplete="current-password">',
        "",
      ),
    );
    replies();
    const next = document.querySelector("button")!;
    const click = vi.spyOn(next, "click");
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    next.addEventListener("click", () =>
      setTimeout(() => {
        document.body.innerHTML =
          '<form><input type="password" name="password" autocomplete="current-password"><button type="submit">Log in</button></form>';
        document.querySelector("form")!.addEventListener("submit", submit);
      }, 250),
    );
    start();
    await vi.advanceTimersByTimeAsync(4000);
    expect(click).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(input("password").value).toBe(password);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("waits for page completion and a manually satisfied Turnstile before requesting credentials", async () => {
    install(
      form +
        '<div class="cf-turnstile"></div><input type="hidden" name="cf-turnstile-response">',
    );
    replies();
    const ready = vi
      .spyOn(document, "readyState", "get")
      .mockReturnValue("loading");
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submit);
    start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).not.toHaveBeenCalled();
    ready.mockReturnValue("complete");
    await vi.advanceTimersByTimeAsync(35000);
    expect(fetchMock).not.toHaveBeenCalled();
    document.querySelector<HTMLInputElement>(
      '[name="cf-turnstile-response"]',
    )!.value = "fixture-user-solved";
    await vi.advanceTimersByTimeAsync(2500);
    expect(submit).toHaveBeenCalledOnce();
  });

  it.each([
    "options",
    "challenge-form",
    "challenge-running",
    "challenge-stage",
  ])(
    "waits for a managed challenge (%s) even with a populated Turnstile response",
    async (marker) => {
      install(
        form +
          '<input type="hidden" name="cf-turnstile-response" value="fixture-unrelated-response">',
      );
      replies();
      if (marker === "options")
        Reflect.set(window, "_cf_chl_opt", { cType: "managed" });
      else
        document.body.insertAdjacentHTML(
          "beforeend",
          `<div id="${marker}"></div>`,
        );
      const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
      document.querySelector("form")!.addEventListener("submit", submit);
      start();
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(input("email").value).toBe("");
      expect(input("password").value).toBe("");
      Reflect.deleteProperty(window, "_cf_chl_opt");
      document.getElementById(marker)?.remove();
      await vi.advanceTimersByTimeAsync(2500);
      expect(submit).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "https://challenges.cloudflare.com/turnstile/v0/widget",
    "http://p0123456789abcdef0123456789abcdef.localhost:43210/cdn-cgi/challenge-platform/h/g/turnstile/fixture",
    "http://p0123456789abcdef0123456789abcdef.localhost:43210/turnstile/v0/widget",
  ])("waits for the challenge iframe at %s", async (src) => {
    install(form + `<iframe src="${src}"></iframe>`);
    replies();
    start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input("password").value).toBe("");
  });

  it("does not treat a remaining opaque challenge query as an unresolved challenge", async () => {
    const path =
      "/login?__cf_chl_tk=fixture%2Bopaque%2fvalue+space&repeat=1&repeat=2";
    install(form, path);
    replies();
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    document.querySelector("form")!.addEventListener("submit", submit);
    start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(submit).toHaveBeenCalledOnce();
    expect(location.pathname + location.search).toBe(path);
  });

  it("clears its filled password without submitting if a managed challenge appears", async () => {
    install();
    replies();
    const click = vi.spyOn(document.querySelector("button")!, "click");
    start();
    await vi.advanceTimersByTimeAsync(1300);
    expect(input("password").value).toBe(password);
    Reflect.set(window, "_cf_chl_opt", { cType: "managed" });
    await vi.advanceTimersByTimeAsync(400);
    expect(input("password").value).toBe("");
    expect(click).not.toHaveBeenCalled();
    Reflect.deleteProperty(window, "_cf_chl_opt");
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(click).not.toHaveBeenCalled();
  });

  it("waits for debounced application models even when submit stays enabled", async () => {
    install();
    replies();
    const model = { email: "", password: "" };
    for (const field of ["email", "password"] as const) {
      input(field).addEventListener("input", () => {
        const value = input(field).value;
        setTimeout(() => {
          model[field] = value;
        }, 400);
      });
    }
    const submit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
      expect(model).toEqual({ email, password });
    });
    document.querySelector("form")!.addEventListener("submit", submit);
    start();
    await vi.advanceTimersByTimeAsync(1400);
    expect(input("password").value).toBe(password);
    expect(model.password).toBe("");
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1100);
    expect(submit).toHaveBeenCalledOnce();
  });

  it.each([
    "signup",
    "reset",
    "dashboard",
    "new-password",
    "otp",
    "external",
    "get",
    "foreign-target",
    "ambiguous",
    "prefilled-password",
    "disabled-field",
    "empty-method",
    "button-get-override",
    "sso",
  ])("does not dispense into %s", async (kind) => {
    const paths: Record<string, string> = {
      signup: "/sign-up",
      reset: "/forgot-password",
      dashboard: "/profile",
    };
    install(form, paths[kind] ?? "/login");
    replies();
    const element = document.querySelector("form")!;
    if (kind === "new-password")
      input("password").autocomplete = "new-password";
    if (kind === "otp")
      element.insertAdjacentHTML(
        "beforeend",
        '<input autocomplete="one-time-code">',
      );
    if (kind === "external") {
      element.action = "https://elsewhere.test/login";
      element.method = "post";
    }
    if (kind === "get") element.method = "get";
    if (kind === "foreign-target") element.target = "_blank";
    if (kind === "ambiguous") element.append(input("email").cloneNode());
    if (kind === "prefilled-password") input("password").value = "user-value";
    if (kind === "disabled-field") input("email").disabled = true;
    if (kind === "empty-method") element.setAttribute("method", "");
    if (kind === "button-get-override") {
      element.method = "post";
      document.querySelector("button")!.setAttribute("formmethod", "");
    }
    if (kind === "sso")
      element.insertAdjacentHTML("afterbegin", "<h1>Single Sign-On</h1>");
    start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not replace a different prefilled account or fetch its password", async () => {
    install();
    replies();
    input("email").value = "other@example.test";
    start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(input("email").value).toBe("other@example.test");
    expect(input("password").value).toBe("");
  });

  it.each(["cancel", "replace", "navigate", "action", "managed-challenge"])(
    "rejects credential resolution after %s",
    async (kind) => {
      install();
      let complete!: (value: unknown) => void;
      fetchMock.mockReturnValue(
        new Promise((resolve) => {
          complete = resolve;
        }),
      );
      start();
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchMock).toHaveBeenCalledOnce();
      if (kind === "cancel") client.cancel();
      if (kind === "replace") document.body.innerHTML = form;
      if (kind === "navigate") history.replaceState({}, "", "/sign-up");
      if (kind === "action")
        document.querySelector("form")!.action = "https://elsewhere.test/login";
      if (kind === "managed-challenge")
        Reflect.set(window, "_cf_chl_opt", { cType: "managed" });
      const reply = {
        loginFlow: "cloudflare",
        username: email,
        continuation: "a".repeat(32),
      };
      complete({ ok: true, json: async () => reply });
      await vi.advanceTimersByTimeAsync(1500);
      expect(input("email").value).toBe("");
      expect(input("password").value).toBe("");
      expect(reply.username).toBeNull();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("preserves a manual password replacement during state settling without submitting", async () => {
    install();
    replies();
    const click = vi.spyOn(document.querySelector("button")!, "click");
    start();
    await vi.advanceTimersByTimeAsync(1300);
    expect(input("password").value).toBe(password);
    input("password").value = "manual-replacement";
    await vi.advanceTimersByTimeAsync(400);
    expect(click).not.toHaveBeenCalled();
    expect(input("password").value).toBe("manual-replacement");
  });

  it("stops without retrying a denied credential capability", async () => {
    install();
    fetchMock.mockResolvedValue({ ok: false });
    start();
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(input("email").value).toBe("");
  });

  it.each([5000, 91000])(
    "starts automatic login in the replacement document after %i ms of challenge waiting",
    async (wait) => {
      install('<div id="challenge-stage">Just a moment...</div>');
      Reflect.set(window, "_cf_chl_opt", { cType: "managed" });
      replies();
      start();
      await vi.advanceTimersByTimeAsync(wait);
      expect(fetchMock).not.toHaveBeenCalled();
      window.dispatchEvent(new Event("pagehide"));
      // Flush the asynchronous postMessage cancellation report, not a poll.
      await vi.advanceTimersByTimeAsync(100);
      expect(vi.getTimerCount()).toBe(0);
      expect(fetchMock).not.toHaveBeenCalled();
      // A new document installs fresh client guards; a page-local timeout or
      // unload must not carry over to the replacement document's nonce.
      Reflect.deleteProperty(window, "_cf_chl_opt");
      install(form, "/login?cleared=fixture");
      const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
      document.querySelector("form")!.addEventListener("submit", submit);
      start("c".repeat(32));
      await vi.advanceTimersByTimeAsync(2500);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe(
        `/__sortofremoteng_autologin?nonce=${"c".repeat(32)}`,
      );
      expect(input("email").value).toBe(email);
      expect(input("password").value).toBe(password);
      expect(submit).toHaveBeenCalledOnce();
    },
  );

  it("bounds polling while a challenge remains unresolved", async () => {
    install(form + '<div class="cf-turnstile"></div>');
    replies();
    start();
    await vi.advanceTimersByTimeAsync(91000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
