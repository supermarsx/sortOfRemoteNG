import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";

const helper = readFileSync(
  "src-tauri/crates/sorng-protocols/src/synology_autologin_client.js",
  "utf8",
);
const client = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
const automation = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_automation_client.js",
  "utf8",
);
const win = window as unknown as {
  __sorng_autologin: {
    fetchCredsAndRun(
      nonce: string,
      selectors?: null,
      loginFlow?: string,
    ): Promise<unknown>;
    cancel(): void;
  };
  __sorng_synology_login: { cancel(): void };
  __autologin_last?: { ok: boolean; reason: string };
};
const username = "synthetic-user",
  password = "synthetic-password";
let fetchMock: ReturnType<typeof vi.fn>;
let submit: ReturnType<typeof vi.fn<(event: Event) => void>>;
let originalParent: PropertyDescriptor | undefined;
function route(hash: string) {
  history.replaceState(null, "", `/${hash}`);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}
function showAccount() {
  document.body.innerHTML = `<div id="sds-login-vue"><div class="login-tabs-content-wrapper"><form id="dsm-user-fieldset"><input syno-id="username" name="username" type="text" autocomplete="username"><input name="password" type="password" autocomplete="current-password" hidden></form><div role="button" syno-id="account-panel-next-btn">Next</div></div></div>`;
}
function showPassword(navigate = true) {
  document.querySelector("#sds-login-vue")!.innerHTML =
    `<div class="login-tabs-content-wrapper"><form id="dsm-pass-fieldset"><input name="username" autocomplete="username" hidden value="${username}"><input syno-id="password" name="current-password" type="password" autocomplete="current-password"></form><div role="button" syno-id="password-panel-next-btn">Sign in</div></div>`;
  document
    .querySelector('[syno-id="password-panel-next-btn"]')!
    .addEventListener("click", submit);
  if (navigate) route("#/signin/password");
}
function begin() {
  return win.__sorng_autologin.fetchCredsAndRun(
    "a".repeat(32),
    null,
    "synology",
  );
}
beforeEach(() => {
  vi.useFakeTimers();
  // Keep fake-timer accounting specific to the login lifecycle; jsdom's
  // parent postMessage delivery schedules its own unrelated task.
  vi.spyOn(window, "postMessage").mockImplementation(() => {});
  history.replaceState(null, "", "/#/signin");
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[hidden]") ? null : document.body;
    },
  );
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
  fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes("phase=password")
        ? { loginFlow: "synology", password }
        : { loginFlow: "synology", username, continuation: "b".repeat(32) },
  }));
  submit = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  window.eval(helper);
  window.eval(client);
  showAccount();
});
afterEach(() => {
  win.__sorng_autologin.cancel();
  for (const event of ["pagehide", "unload"]) {
    window.removeEventListener(event, win.__sorng_autologin.cancel);
    window.removeEventListener(event, win.__sorng_synology_login.cancel);
  }
  Reflect.deleteProperty(win, "__sorng_autologin");
  Reflect.deleteProperty(win, "__sorng_synology_login");
  Reflect.deleteProperty(win, "__autologin_last");
  Reflect.deleteProperty(document, "readyState");
  if (originalParent) Object.defineProperty(window, "parent", originalParent);
  originalParent = undefined;
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("reviewed DSM website login", () => {
  it("waits through replacement of an empty Vue mount before capturing the account form", async () => {
    document.body.innerHTML = '<div id="sds-login-vue"></div>';
    const pending = begin();
    await vi.advanceTimersByTimeAsync(0);
    showAccount();
    const next = vi.fn();
    document
      .querySelector('[syno-id="account-panel-next-btn"]')!
      .addEventListener("click", next);
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledOnce();
    showPassword();
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(submit).toHaveBeenCalledOnce();
  });
  it.each(["load", "transitionend", "animationend", "resize"])(
    "reacts to %s CSS visibility readiness without a DOM mutation",
    async (event) => {
      let visible = false;
      vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
        function (this: HTMLElement) {
          return visible && !this.closest("[hidden]") ? document.body : null;
        },
      );
      const pending = begin();
      await vi.advanceTimersByTimeAsync(20000);
      expect(fetchMock).not.toHaveBeenCalled();
      visible = true;
      if (event === "resize") window.dispatchEvent(new Event(event));
      else document.dispatchEvent(new Event(event));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock).toHaveBeenCalledOnce();
      showPassword();
      await vi.advanceTimersByTimeAsync(0);
      await pending;
      expect(submit).toHaveBeenCalledOnce();
    },
  );
  it("waits for DOMContentLoaded without consuming a username during parsing", async () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
    const pending = begin();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "interactive",
    });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await vi.advanceTimersByTimeAsync(0);
    showPassword();
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(submit).toHaveBeenCalledOnce();
  });
  it("fills each field once while its button is disabled, waits for Vue validation, then clicks once", async () => {
    const field = document.querySelector(
      '[syno-id="username"]',
    ) as HTMLInputElement;
    const button = document.querySelector(
      '[syno-id="account-panel-next-btn"]',
    )!;
    const next = vi.fn();
    button.addEventListener("click", next);
    button.classList.add("disable");
    const accountInput = vi.fn(() => {
      field.disabled = true;
      button.classList.add("spin");
      setTimeout(() => {
        field.disabled = false;
        button.classList.remove("disable", "spin");
      }, 400);
    });
    field.addEventListener("input", accountInput);
    const pending = begin();
    await vi.advanceTimersByTimeAsync(0);
    expect(field.value).toBe(username);
    expect(next).not.toHaveBeenCalled();
    expect(
      field.form!.dispatchEvent(new Event("submit", { cancelable: true })),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(next).toHaveBeenCalledOnce();
    expect(accountInput).toHaveBeenCalledOnce();
    showPassword(false);
    const secret = document.querySelector(
      '[name="current-password"]',
    ) as HTMLInputElement;
    const signIn = document.querySelector(
      '[syno-id="password-panel-next-btn"]',
    )!;
    signIn.setAttribute("aria-disabled", "true");
    const passwordInput = vi.fn(() => {
      secret.readOnly = true;
      setTimeout(() => {
        secret.readOnly = false;
        signIn.removeAttribute("aria-disabled");
      }, 600);
    });
    secret.addEventListener("input", passwordInput);
    route("#/signin/password");
    await vi.advanceTimersByTimeAsync(0);
    expect(secret.value).toBe(password);
    expect(submit).not.toHaveBeenCalled();
    expect(
      secret.form!.dispatchEvent(new Event("submit", { cancelable: true })),
    ).toBe(false);
    await vi.advanceTimersByTimeAsync(600);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(passwordInput).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(
      secret.form!.dispatchEvent(new Event("submit", { cancelable: true })),
    ).toBe(true);
  });
  it("waits through a slow overlapping account/password Vue transition without requesting password early", async () => {
    const pending = begin();
    await vi.advanceTimersByTimeAsync(0);
    const oldPanel = document.querySelector(".login-tabs-content-wrapper")!;
    showPassword(false);
    document.querySelector("#sds-login-vue")!.prepend(oldPanel);
    route("#/signin/password");
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    oldPanel.remove();
    document.dispatchEvent(new Event("transitionend"));
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledOnce();
  });
  it.each(["hidden", "disabled", "readonly"])(
    "does not write a password when a focus handler makes the field %s before the write",
    async (change) => {
      const pending = begin();
      await vi.advanceTimersByTimeAsync(0);
      showPassword(false);
      const field = document.querySelector(
        '[name="current-password"]',
      ) as HTMLInputElement;
      field.addEventListener("focus", () => {
        if (change === "hidden") field.hidden = true;
        if (change === "disabled") field.disabled = true;
        if (change === "readonly") field.readOnly = true;
      });
      route("#/signin/password");
      await vi.advanceTimersByTimeAsync(0);
      await pending;
      expect(field.value).toBe("");
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it.each(["replacement", "timeout", "cancel"])(
    "clears its unsent password and restores manual submit after %s while waiting for the button",
    async (reason) => {
      const pending = begin();
      await vi.advanceTimersByTimeAsync(0);
      showPassword(false);
      const field = document.querySelector(
        '[name="current-password"]',
      ) as HTMLInputElement;
      const button = document.querySelector(
        '[syno-id="password-panel-next-btn"]',
      )!;
      button.classList.add("disable");
      route("#/signin/password");
      await vi.advanceTimersByTimeAsync(0);
      expect(field.value).toBe(password);
      expect(
        field.form!.dispatchEvent(new Event("submit", { cancelable: true })),
      ).toBe(false);
      if (reason === "replacement") button.replaceWith(button.cloneNode(true));
      if (reason === "cancel") win.__sorng_autologin.cancel();
      await vi.advanceTimersByTimeAsync(reason === "timeout" ? 25000 : 0);
      await pending;
      expect(field.value).toBe("");
      expect(submit).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        field.form!.dispatchEvent(new Event("submit", { cancelable: true })),
      ).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("expires preflight once after 90s, does not renew on mutations, and removes readiness listeners", async () => {
    document.body.innerHTML = '<div id="sds-login-vue"></div>';
    const pending = begin();
    await begin();
    await vi.advanceTimersByTimeAsync(89999);
    document.body.setAttribute("data-ready", "still-loading");
    document.dispatchEvent(new Event("load"));
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(win.__autologin_last?.reason).toBe("reviewed-login-timeout");
    showAccount();
    document.dispatchEvent(new Event("transitionend"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["cancel", "timeout", "route-aba", "replacement", "action"])(
    "rejects and clears a late first username body after %s without another request",
    async (change) => {
      let release!: (value: unknown) => void;
      const reply = {
        loginFlow: "synology",
        username,
        continuation: "b".repeat(32),
      };
      fetchMock.mockImplementation(async () => ({
        ok: true,
        json: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      }));
      const pending = begin();
      await vi.advanceTimersByTimeAsync(0);
      const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
      if (change === "cancel") win.__sorng_autologin.cancel();
      if (change === "timeout") await vi.advanceTimersByTimeAsync(90000);
      if (change === "route-aba") {
        route("#/signin/select-auth");
        route("#/signin");
      }
      if (change === "replacement") showAccount();
      if (change === "action")
        document
          .querySelector("form")!
          .setAttribute("action", "https://other.invalid/");
      await vi.advanceTimersByTimeAsync(0);
      expect(signal.aborted).toBe(true);
      release(reply);
      await vi.advanceTimersByTimeAsync(0);
      await pending;
      expect(reply.username).toBeNull();
      expect(reply.continuation).toBeNull();
      expect(
        (document.querySelector('[syno-id="username"]') as HTMLInputElement)
          .value,
      ).toBe("");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("rejects an overdue username microtask before a delayed deadline timer runs", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let release!: (value: unknown) => void;
    const reply = {
      loginFlow: "synology",
      username,
      continuation: "b".repeat(32),
    };
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    }));
    const pending = begin();
    await vi.advanceTimersByTimeAsync(0);
    now = 90001;
    release(reply);
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(reply.username).toBeNull();
    expect(
      (document.querySelector('[syno-id="username"]') as HTMLInputElement)
        .value,
    ).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("does not fall back to generic credential acquisition for an unknown purpose hint", async () => {
    await win.__sorng_autologin.fetchCredsAndRun(
      "a".repeat(32),
      null,
      "unknown",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(win.__autologin_last?.reason).toBe("invalid-login-flow");
  });
  it("keeps manual browsing credential-free and derives explicit HTTPS staged login", () => {
    const manual = {
      protocol: "https" as const,
      username,
      password,
      httpApplication: {
        version: 1 as const,
        id: "synology-dsm",
        loginMode: "manual" as const,
      },
    };
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "synology-dsm" })
        ?.loginMode,
    ).toBe("manual");
    expect(resolveHttpApplicationLogin(manual)).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    const form = {
      ...manual,
      httpApplication: {
        ...manual.httpApplication,
        loginMode: "form" as const,
      },
    };
    expect(resolveHttpApplicationLogin(form)).toMatchObject({
      credentials: { username, password },
      upstreamAuthMode: "synology-form",
      loginFlow: "synology",
    });
    expect(() =>
      validateHttpApplicationTarget(form, "http://nas.invalid/"),
    ).toThrow("requires an HTTPS");
    expect(() =>
      resolveHttpApplicationLogin({
        ...form,
        httpAutoLoginSelectors: { passwordSelector: "#guess" },
      }),
    ).toThrow("selector overrides");
  });
  it("releases no password at account stage, then fills the replaced reviewed password form once", async () => {
    const next = vi.fn();
    document
      .querySelector('[syno-id="account-panel-next-btn"]')!
      .addEventListener("click", next);
    const pending = begin();
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledOnce();
    expect(
      (document.querySelector('[name="username"]') as HTMLInputElement).value,
    ).toBe(username);
    expect(
      (document.querySelector('[name="password"]') as HTMLInputElement).value,
    ).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
    showPassword();
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      redirect: "error",
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(
      (document.querySelector('[name="current-password"]') as HTMLInputElement)
        .value,
    ).toBe(password);
    expect(submit).toHaveBeenCalledOnce();
    await begin();
    await vi.advanceTimersByTimeAsync(30000);
    expect(submit).toHaveBeenCalledOnce();
  });
  it("waits for the DSM SPA account panel after deferred activation without releasing its password early", async () => {
    document.body.innerHTML = '<div id="dsm-loading">Loading DSM</div>';
    const pending = begin();
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    showAccount();
    const next = vi.fn();
    document
      .querySelector('[syno-id="account-panel-next-btn"]')!
      .addEventListener("click", next);
    await vi.advanceTimersByTimeAsync(0);
    expect(next).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      (document.querySelector('[name="password"]') as HTMLInputElement).value,
    ).toBe("");

    showPassword();
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledOnce();
    expect(
      (document.querySelector('[name="current-password"]') as HTMLInputElement)
        .value,
    ).toBe(password);
  });
  it.each([
    "foreign-action",
    "wrong-user",
    "changed-root",
    "captcha",
    "other-route",
  ])("refuses %s without requesting the password", async (attack) => {
    const pending = begin();
    await vi.advanceTimersByTimeAsync(0);
    showPassword(false);
    if (attack === "foreign-action")
      document
        .querySelector("form")!
        .setAttribute("action", "https://other.invalid/");
    if (attack === "wrong-user")
      (document.querySelector('[name="username"]') as HTMLInputElement).value =
        "other";
    if (attack === "changed-root")
      document.querySelector("#sds-login-vue")!.outerHTML =
        document.querySelector("#sds-login-vue")!.outerHTML;
    if (attack === "captcha")
      document
        .querySelector("form")!
        .insertAdjacentHTML("beforeend", '<input name="captcha">');
    if (attack === "other-route") route("#/signin/select-auth");
    else route("#/signin/password");
    await vi.advanceTimersByTimeAsync(15000);
    await pending;
    expect(submit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(win.__autologin_last?.ok).toBe(false);
  });
  it("refuses an account-stage external action before any click or password request", async () => {
    document
      .querySelector("form")!
      .setAttribute("action", "https://other.invalid/");
    await begin();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it("waits for an initially disabled password panel without releasing the password early", async () => {
    const pending = begin();
    await vi.advanceTimersByTimeAsync(0);
    showPassword(false);
    const field = document.querySelector('[name="current-password"]')!;
    field.setAttribute("disabled", "");
    route("#/signin/password");
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledOnce();
    field.removeAttribute("disabled");
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledOnce();
  });
  it.each(["cancel", "navigation", "route-aba", "action", "replacement"])(
    "refuses a late password response after %s",
    async (change) => {
      let release!: (value: unknown) => void;
      const reply = { loginFlow: "synology", password };
      fetchMock
        .mockImplementationOnce(async () => ({
          ok: true,
          json: async () => ({
            loginFlow: "synology",
            username,
            continuation: "b".repeat(32),
          }),
        }))
        .mockImplementation(
          () =>
            new Promise((resolve) => {
              release = resolve;
            }),
        );
      const pending = begin();
      await vi.advanceTimersByTimeAsync(0);
      showPassword();
      await vi.advanceTimersByTimeAsync(0);
      if (change === "cancel") win.__sorng_autologin.cancel();
      if (change === "navigation") route("#/signin/select-auth");
      if (change === "route-aba") {
        route("#/signin");
        route("#/signin/password");
      }
      if (change === "action")
        document
          .querySelector("form")!
          .setAttribute("action", "https://other.invalid/");
      if (change === "replacement") {
        const control = document.querySelector('[name="current-password"]')!;
        control.replaceWith(control.cloneNode(true));
      }
      release({ ok: true, json: async () => reply });
      await vi.advanceTimersByTimeAsync(0);
      await pending;
      expect(
        (
          document.querySelector(
            '[name="current-password"]',
          ) as HTMLInputElement
        ).value,
      ).toBe("");
      expect(reply.password).toBeNull();
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it("removes its unsent password if an input handler changes the captured form", async () => {
    const pending = begin();
    await vi.advanceTimersByTimeAsync(0);
    showPassword(false);
    const field = document.querySelector(
      '[name="current-password"]',
    ) as HTMLInputElement;
    field.addEventListener("input", () =>
      field.form!.setAttribute("action", "https://other.invalid/"),
    );
    route("#/signin/password");
    await vi.advanceTimersByTimeAsync(0);
    await pending;
    expect(field.value).toBe("");
    expect(submit).not.toHaveBeenCalled();
  });
  it.each(["cancel", "timeout", "password-error"])(
    "stops %s without retrying submit or credentials",
    async (reason) => {
      if (reason === "password-error")
        fetchMock
          .mockImplementationOnce(async () => ({
            ok: true,
            json: async () => ({
              loginFlow: "synology",
              username,
              continuation: "b".repeat(32),
            }),
          }))
          .mockImplementation(async () => ({ ok: false }));
      const pending = begin();
      await vi.advanceTimersByTimeAsync(0);
      if (reason === "cancel") win.__sorng_autologin.cancel();
      if (reason === "password-error") showPassword();
      await vi.advanceTimersByTimeAsync(26000);
      await pending;
      expect(submit).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(
        reason === "password-error" ? 2 : 1,
      );
    },
  );
});

describe("reviewed DSM OTP SPA container", () => {
  function bridge() {
    history.replaceState(null, "", "/#/signin/otp");
    document.body.innerHTML =
      '<div id="sds-login-vue"><div class="login-tabs-content-wrapper"><div id="dsm-otp-fieldset"><input type="text" name="one-time-code" autocomplete="one-time-code"><input type="checkbox" name="trust-device"></div><div role="button" syno-id="otp-panel-next-btn">Verify</div></div></div>';
    const handlers: EventListener[] = [],
      post = vi.fn();
    const parent = { postMessage: post };
    originalParent = Object.getOwnPropertyDescriptor(window, "parent");
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parent,
    });
    vi.spyOn(window, "addEventListener").mockImplementation(
      (name, callback) => {
        if (name === "message") handlers.push(callback as EventListener);
      },
    );
    const identity = {
      sessionId: "fixture",
      documentToken: "d".repeat(32),
      documentSequence: 1,
      navigationToken: null,
    };
    window.eval(
      `(function(){var p=${JSON.stringify(identity)},u=new URL(location.href);${automation}\n})();`,
    );
    const challenge =
      getHttpApplicationProfile("synology-dsm")!.totpChallenges![0];
    const payload = { ...challenge, nonce: "b".repeat(32) };
    document
      .querySelector('[syno-id="otp-panel-next-btn"]')!
      .addEventListener("click", submit);
    // Message URL is the precise document URL, not the upstream authority.
    const send = (action: string, value: object) =>
      handlers.forEach((handler) =>
        handler({
          source: parent,
          origin: "http://localhost:3000",
          data: {
            type: "sorng_web_automation",
            version: 1,
            ...identity,
            url: location.href,
            requestId: "a".repeat(32),
            action,
            payload: value,
          },
        } as unknown as Event),
      );
    return { send, post, payload };
  }
  it("fills and submits one explicit code without enabling trust-device or echoing it", () => {
    const { send, post, payload } = bridge();
    send("totpProbe", payload);
    send("totpSubmit", {
      nonce: payload.nonce,
      code: "123456",
      expires: Date.now() + 20000,
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(
      (document.querySelector('[name="trust-device"]') as HTMLInputElement)
        .checked,
    ).toBe(false);
    expect(JSON.stringify(post.mock.calls)).not.toContain("123456");
    send("totpSubmit", {
      nonce: payload.nonce,
      code: "123456",
      expires: Date.now() + 20000,
    });
    expect(submit).toHaveBeenCalledOnce();
  });
  it.each([
    "replacement",
    "disabled",
    "different-route",
    "password",
    "captcha",
    "root-reparent",
    "panel-reparent",
    "root-reparent-input",
    "panel-reparent-input",
  ])("refuses OTP after %s and does not click", (attack) => {
    const { send, payload } = bridge();
    send("totpProbe", payload);
    const field = document.querySelector('[name="one-time-code"]')!;
    if (attack === "replacement") field.replaceWith(field.cloneNode(true));
    if (attack === "disabled") field.setAttribute("disabled", "");
    if (attack === "different-route")
      history.replaceState(null, "", "/#/signin/password");
    if (attack === "password")
      document
        .querySelector("#dsm-otp-fieldset")!
        .insertAdjacentHTML("beforeend", '<input type="password">');
    if (attack === "captcha")
      document
        .querySelector("#dsm-otp-fieldset")!
        .insertAdjacentHTML("beforeend", '<input name="captcha">');
    if (
      attack.startsWith("root-reparent") ||
      attack.startsWith("panel-reparent")
    ) {
      const reparent = () => {
        const old = document.querySelector(
          attack.startsWith("root-reparent")
            ? "#sds-login-vue"
            : ".login-tabs-content-wrapper",
        )!;
        const replacement = old.cloneNode(false) as Element;
        old.replaceWith(replacement);
        replacement.append(...Array.from(old.childNodes));
      };
      if (attack.endsWith("-input"))
        field.addEventListener("input", reparent, { once: true });
      else reparent();
    }
    send("totpSubmit", {
      nonce: payload.nonce,
      code: "123456",
      expires: Date.now() + 20000,
    });
    expect(submit).not.toHaveBeenCalled();
    expect(
      (document.querySelector('[name="one-time-code"]') as HTMLInputElement)
        .value,
    ).toBe("");
  });
});
