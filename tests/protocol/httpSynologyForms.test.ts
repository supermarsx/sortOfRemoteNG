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
  __sorng_synology_login: {
    cancel(): void;
    getStatus(): { phase: string; reason: string };
  };
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
async function advanceRenderTurns() {
  // Each action waits for 400ms of reviewed-panel quiet; one turn covers a
  // readiness check, a fill and its click.
  await vi.advanceTimersByTimeAsync(1000);
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
  // Sign in resolves the run; page-observed verification continues for 30s.
  async function finishVerification() {
    await vi.advanceTimersByTimeAsync(30000);
  }
  it("acts once interactive after panel quiet and input settling, then clicks a delayed Next handler once", async () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "interactive",
    });
    const button = document.querySelector(
      '[syno-id="account-panel-next-btn"]',
    )!;
    const field = document.querySelector('[syno-id="username"]')!;
    const next = vi.fn(() => showPassword());
    field.addEventListener("input", () => {
      setTimeout(() => button.addEventListener("click", next), 100);
    });
    const pending = begin();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    // A slow image may hold load; interactive reviewed controls are enough.
    await vi.advanceTimersByTimeAsync(399);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(399);
    expect(next).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(next).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    await pending;
    expect(submit).toHaveBeenCalledOnce();
    await finishVerification();
    expect(win.__sorng_synology_login.getStatus()).toEqual({
      phase: "submitted",
      reason: "sign-in-unconfirmed",
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("requires a visible Next and resamples a briefly disabled username without waiting for unrelated DOM quiet", async () => {
    const field = document.querySelector(
      '[syno-id="username"]',
    ) as HTMLInputElement;
    const button = document.querySelector(
      '[syno-id="account-panel-next-btn"]',
    ) as HTMLElement;
    button.hidden = true;
    button.classList.add("disable");
    const pending = begin();
    await vi.advanceTimersByTimeAsync(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(win.__sorng_synology_login.getStatus()).toEqual({
      phase: "waiting_account_stable",
      reason: "button-hidden",
    });
    button.hidden = false;
    await vi.advanceTimersByTimeAsync(50);
    field.disabled = true;
    await vi.advanceTimersByTimeAsync(50);
    field.disabled = false;
    // Mutations outside the reviewed panel do not restart its quiet period.
    for (let index = 0; index < 3; index++) {
      document.body.append(document.createElement("span"));
      await vi.advanceTimersByTimeAsync(100);
      expect(fetchMock).not.toHaveBeenCalled();
    }
    document.body.append(document.createElement("span"));
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(field.value).toBe(username);
    // A disabled Next may need this username input before Vue enables it.
    button.classList.remove("disable");
    await vi.advanceTimersByTimeAsync(99);
    expect(fetchMock).toHaveBeenCalledOnce();
    win.__sorng_synology_login.cancel();
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["account", "password"])(
    "waits for the same %s field to become editable after its credential reply",
    async (stage) => {
      let release!: (value: unknown) => void;
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: () =>
          (stage === "password") === url.includes("phase=password")
            ? new Promise((resolve) => {
                release = resolve;
              })
            : Promise.resolve(
                url.includes("phase=password")
                  ? { loginFlow: "synology", password }
                  : {
                      loginFlow: "synology",
                      username,
                      continuation: "b".repeat(32),
                    },
              ),
      }));
      const pending = begin();
      await advanceRenderTurns();
      if (stage === "password") {
        showPassword();
        await advanceRenderTurns();
      }
      const field = document.querySelector(
        stage === "account" ? '[syno-id="username"]' : '[syno-id="password"]',
      ) as HTMLInputElement;
      field.disabled = true;
      const reply =
        stage === "account"
          ? { loginFlow: "synology", username, continuation: "b".repeat(32) }
          : { loginFlow: "synology", password };
      release(reply);
      await advanceRenderTurns();
      expect(field.value).toBe("");
      expect(win.__sorng_synology_login.getStatus().reason).toBe(
        "field-disabled",
      );
      expect(fetchMock).toHaveBeenCalledTimes(stage === "account" ? 1 : 2);
      field.disabled = false;
      await advanceRenderTurns();
      if (stage === "account") {
        expect(field.value).toBe(username);
        showPassword();
        await advanceRenderTurns();
      }
      await pending;
      expect(submit).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(Object.values(reply)).not.toContain(
        stage === "account" ? username : password,
      );
    },
  );
  // Trusted (user) edits stop the helper: see synologyLoginTimeline.test.ts.
  it.each([
    ["account", "different"],
    ["password", "different"],
    ["password", "same-as-held"],
  ])(
    "writes over a scripted %s field %s value once it is editable, with one grant per stage",
    async (stage, kind) => {
      let release!: (value: unknown) => void;
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: () =>
          (stage === "password") === url.includes("phase=password")
            ? new Promise((resolve) => {
                release = resolve;
              })
            : Promise.resolve(
                url.includes("phase=password")
                  ? { loginFlow: "synology", password }
                  : {
                      loginFlow: "synology",
                      username,
                      continuation: "b".repeat(32),
                    },
              ),
      }));
      const pending = begin();
      await advanceRenderTurns();
      if (stage === "password") {
        showPassword();
        await advanceRenderTurns();
      }
      const field = document.querySelector(
        stage === "account" ? '[syno-id="username"]' : '[syno-id="password"]',
      ) as HTMLInputElement;
      field.disabled = true;
      release(
        stage === "account"
          ? { loginFlow: "synology", username, continuation: "b".repeat(32) }
          : { loginFlow: "synology", password },
      );
      await advanceRenderTurns();
      const scriptedValue =
        kind === "same-as-held" ? password : "scripted-prefill";
      field.value = scriptedValue;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await advanceRenderTurns();
      expect(field.value).toBe(scriptedValue);
      field.disabled = false;
      await advanceRenderTurns();
      expect(field.value).toBe(stage === "account" ? username : password);
      if (stage === "account") {
        showPassword();
        await advanceRenderTurns();
      }
      await pending;
      expect(submit).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );
  it.each([50, 150, 250, 450, 900, 1300])(
    "cancels all settlement timers at %dms without another grant or click",
    async (at) => {
      const next = vi.fn(() => showPassword());
      document
        .querySelector('[syno-id="account-panel-next-btn"]')!
        .addEventListener("click", next);
      const pending = begin();
      await vi.advanceTimersByTimeAsync(at);
      const requests = fetchMock.mock.calls.length;
      const clicks = next.mock.calls.length;
      win.__sorng_synology_login.cancel();
      await pending;
      await vi.advanceTimersByTimeAsync(90000);
      expect(fetchMock).toHaveBeenCalledTimes(requests);
      expect(next).toHaveBeenCalledTimes(clicks);
      expect(submit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(
        document.querySelector<HTMLInputElement>('[syno-id="password"]')
          ?.value ?? "",
      ).toBe("");
    },
  );
  it("reports when its one Next click never advances to the password stage", async () => {
    const next = vi.fn();
    document
      .querySelector('[syno-id="account-panel-next-btn"]')!
      .addEventListener("click", next);
    const pending = begin();
    await advanceRenderTurns();
    expect(next).toHaveBeenCalledOnce();
    // Username release to Sign in is capped at 85s, below the native 90s.
    await vi.advanceTimersByTimeAsync(85000);
    await pending;
    expect(win.__sorng_synology_login.getStatus()).toEqual({
      phase: "timeout",
      reason: "next-not-advanced",
    });
    showPassword();
    window.dispatchEvent(new Event("load"));
    await advanceRenderTurns();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("exposes a read-only initial snapshot without starting a login", () => {
    const status = win.__sorng_synology_login.getStatus();
    expect(status).toEqual({
      phase: "waiting_document",
      reason: "not-started",
    });
    status.reason = password;
    expect(win.__sorng_synology_login.getStatus().reason).toBe("not-started");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it.each([
    ["root-missing", "#sds-login-vue", "remove", "waiting_root"],
    ["root-ambiguous", "#sds-login-vue", "duplicate", "waiting_root"],
    ["form-missing", "form", "remove", "waiting_account_form"],
    ["form-ambiguous", "form", "duplicate", "waiting_account_form"],
    ["field-missing", '[syno-id="username"]', "remove", "waiting_account_form"],
    [
      "field-ambiguous",
      '[syno-id="username"]',
      "duplicate",
      "waiting_account_form",
    ],
    [
      "button-missing",
      '[syno-id="account-panel-next-btn"]',
      "remove",
      "waiting_account_form",
    ],
    [
      "button-ambiguous",
      '[syno-id="account-panel-next-btn"]',
      "duplicate",
      "waiting_account_form",
    ],
    [
      "field-hidden",
      '[syno-id="username"]',
      "hidden",
      "waiting_account_editable",
    ],
    [
      "field-disabled",
      '[syno-id="username"]',
      "disabled",
      "waiting_account_editable",
    ],
    [
      "field-readonly",
      '[syno-id="username"]',
      "readonly",
      "waiting_account_editable",
    ],
  ])(
    "reports %s without consuming credentials",
    async (reason, selector, change, phase) => {
      const element = document.querySelector(selector)!;
      if (change === "remove") element.remove();
      else if (change === "duplicate") element.after(element.cloneNode(true));
      else element.setAttribute(change, "");
      const pending = begin();
      await advanceRenderTurns();
      expect(win.__sorng_synology_login.getStatus()).toEqual({ phase, reason });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
      win.__sorng_synology_login.cancel();
      await pending;
    },
  );
  it("reports late form readiness with only fixed strings and freezes its terminal snapshot", async () => {
    const events: { phase: string; reason: string; trace: unknown }[] = [];
    const listener = (event: Event) => {
      events.push((event as CustomEvent).detail);
    };
    const statuses = () =>
      events.map(({ phase, reason }) => ({ phase, reason }));
    document.addEventListener("sorng_synology_login_progress", listener);
    try {
      document.body.innerHTML = '<div id="sds-login-vue"></div>';
      const pending = begin();
      await advanceRenderTurns();
      document.dispatchEvent(new Event("load"));
      document.body.setAttribute("data-diagnostic-secret", password);
      await advanceRenderTurns();
      expect(statuses()).toEqual([
        { phase: "waiting_account_form", reason: "form-missing" },
      ]);
      showAccount();
      document.querySelector('[syno-id="username"]')!.outerHTML =
        '<input syno-id="username" type="text" placeholder="Username" enterkeyhint="" autofocus="autofocus" name="username" autocomplete="username" tabindex="1" class="">';
      await advanceRenderTurns();
      showPassword();
      await advanceRenderTurns();
      await pending;
      expect(win.__sorng_synology_login.getStatus()).toEqual({
        phase: "verifying_sign_in",
        reason: "submitted",
      });
      await finishVerification();
      expect(win.__sorng_synology_login.getStatus()).toEqual({
        phase: "submitted",
        reason: "sign-in-unconfirmed",
      });
      const complete = events.slice();
      win.__sorng_synology_login.cancel();
      showAccount();
      document.dispatchEvent(new Event("load"));
      await begin();
      await vi.advanceTimersByTimeAsync(90000);
      expect(events).toEqual(complete);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(submit).toHaveBeenCalledOnce();
      for (const event of events)
        expect(Object.keys(event)).toEqual(["phase", "reason", "trace"]);
      const serialized = JSON.stringify(events);
      for (const secret of [username, password, "a".repeat(32), "b".repeat(32)])
        expect(serialized).not.toContain(secret);
    } finally {
      document.removeEventListener("sorng_synology_login_progress", listener);
    }
  });
  it("revalidates after a diagnostic listener changes the account form before acquisition", async () => {
    const listener = (event: Event) => {
      if ((event as CustomEvent).detail.phase === "requesting_username")
        document.querySelector("form")!.setAttribute("action", "/other");
    };
    document.addEventListener("sorng_synology_login_progress", listener);
    try {
      const pending = begin();
      await advanceRenderTurns();
      await pending;
      expect(win.__sorng_synology_login.getStatus()).toEqual({
        phase: "stopped",
        reason: "unsafe-form-target",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("sorng_synology_login_progress", listener);
    }
  });
  it("waits through replacement of an empty Vue mount before capturing the account form", async () => {
    document.body.innerHTML = '<div id="sds-login-vue"></div>';
    const pending = begin();
    await advanceRenderTurns();
    showAccount();
    const next = vi.fn();
    document
      .querySelector('[syno-id="account-panel-next-btn"]')!
      .addEventListener("click", next);
    await advanceRenderTurns();
    expect(next).toHaveBeenCalledOnce();
    showPassword();
    await advanceRenderTurns();
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
      await advanceRenderTurns();
      expect(fetchMock).toHaveBeenCalledOnce();
      showPassword();
      await advanceRenderTurns();
      await pending;
      expect(submit).toHaveBeenCalledOnce();
    },
  );
  it("waits while the document is loading, then proceeds once interactive without waiting for load", async () => {
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "loading",
    });
    const pending = begin();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(win.__sorng_synology_login.getStatus()).toEqual({
      phase: "waiting_document",
      reason: "document-loading",
    });
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "interactive",
    });
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await advanceRenderTurns();
    expect(fetchMock).toHaveBeenCalledOnce();
    showPassword();
    await advanceRenderTurns();
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
    await advanceRenderTurns();
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
    await advanceRenderTurns();
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
    await advanceRenderTurns();
    const oldPanel = document.querySelector(".login-tabs-content-wrapper")!;
    showPassword(false);
    document.querySelector("#sds-login-vue")!.prepend(oldPanel);
    route("#/signin/password");
    await vi.advanceTimersByTimeAsync(20000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    oldPanel.remove();
    document.dispatchEvent(new Event("transitionend"));
    await advanceRenderTurns();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledOnce();
  });
  it.each(["hidden", "disabled", "readonly"])(
    "does not write a password when a focus handler makes the field %s before the write",
    async (change) => {
      const pending = begin();
      await advanceRenderTurns();
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
      await advanceRenderTurns();
      expect(field.value).toBe("");
      // The refused write is a wait; the field never becomes editable again.
      await vi.advanceTimersByTimeAsync(85000);
      await pending;
      expect(win.__sorng_synology_login.getStatus()).toEqual({
        phase: "timeout",
        reason: "password-panel-never-appeared",
      });
      expect(field.value).toBe("");
      expect(submit).not.toHaveBeenCalled();
    },
  );
  it.each(["foreign-action", "timeout", "cancel"])(
    "clears its unsent password and restores manual submit after %s while waiting for the button",
    async (reason) => {
      const pending = begin();
      await advanceRenderTurns();
      showPassword(false);
      const field = document.querySelector(
        '[name="current-password"]',
      ) as HTMLInputElement;
      const button = document.querySelector(
        '[syno-id="password-panel-next-btn"]',
      )!;
      button.classList.add("disable");
      route("#/signin/password");
      await advanceRenderTurns();
      expect(field.value).toBe(password);
      expect(
        field.form!.dispatchEvent(new Event("submit", { cancelable: true })),
      ).toBe(false);
      if (reason === "foreign-action")
        field.form!.setAttribute("action", "https://other.invalid/");
      if (reason === "cancel") win.__sorng_autologin.cancel();
      await vi.advanceTimersByTimeAsync(reason === "timeout" ? 85000 : 0);
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
  it("keeps its filled password across a replaced Sign in button and clicks the current button once", async () => {
    const pending = begin();
    await advanceRenderTurns();
    showPassword(false);
    const field = document.querySelector(
      '[name="current-password"]',
    ) as HTMLInputElement;
    const button = document.querySelector(
      '[syno-id="password-panel-next-btn"]',
    )!;
    button.classList.add("disable");
    route("#/signin/password");
    await advanceRenderTurns();
    expect(field.value).toBe(password);
    button.replaceWith(button.cloneNode(true));
    await advanceRenderTurns();
    expect(field.value).toBe(password);
    expect(
      field.form!.dispatchEvent(new Event("submit", { cancelable: true })),
    ).toBe(false);
    const current = document.querySelector(
      '[syno-id="password-panel-next-btn"]',
    )!;
    const signIn = vi.fn();
    current.addEventListener("click", signIn);
    current.classList.remove("disable");
    await advanceRenderTurns();
    await pending;
    expect(signIn).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("stops an unrecognized login root after the 45s layout grace, does not renew on mutations, and removes readiness listeners", async () => {
    document.body.innerHTML = '<div id="sds-login-vue"></div>';
    const pending = begin();
    await begin();
    await vi.advanceTimersByTimeAsync(44999);
    document.body.setAttribute("data-ready", "still-loading");
    document.dispatchEvent(new Event("load"));
    expect(win.__sorng_synology_login.getStatus()).toEqual({
      phase: "waiting_account_form",
      reason: "form-missing",
    });
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(win.__autologin_last?.reason).toBe("reviewed-login-stopped");
    expect(win.__sorng_synology_login.getStatus()).toEqual({
      phase: "stopped",
      reason: "layout-unrecognized",
    });
    showAccount();
    document.dispatchEvent(new Event("transitionend"));
    await advanceRenderTurns();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(win.__sorng_synology_login.getStatus()).toEqual({
      phase: "stopped",
      reason: "layout-unrecognized",
    });
  });
  it.each(["cancel", "timeout", "action"])(
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
      await advanceRenderTurns();
      const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
      if (change === "cancel") win.__sorng_autologin.cancel();
      if (change === "timeout") await vi.advanceTimersByTimeAsync(90000);
      if (change === "action")
        document
          .querySelector("form")!
          .setAttribute("action", "https://other.invalid/");
      await advanceRenderTurns();
      expect(signal.aborted).toBe(true);
      release(reply);
      await advanceRenderTurns();
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
  it.each(["route-aba", "replacement"])(
    "keeps a late first username body after %s and fills the current reviewed field with one request",
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
      await advanceRenderTurns();
      const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
      if (change === "route-aba") {
        route("#/signin/select-auth");
        route("#/signin");
      }
      if (change === "replacement") showAccount();
      await advanceRenderTurns();
      expect(signal.aborted).toBe(false);
      release(reply);
      await advanceRenderTurns();
      expect(reply.username).toBeNull();
      expect(reply.continuation).toBeNull();
      expect(
        (document.querySelector('[syno-id="username"]') as HTMLInputElement)
          .value,
      ).toBe(username);
      expect(fetchMock).toHaveBeenCalledOnce();
      win.__sorng_synology_login.cancel();
      await pending;
      expect(vi.getTimerCount()).toBe(0);
    },
  );
  it("rejects an overdue username microtask before a delayed deadline timer runs", async () => {
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
    await advanceRenderTurns();
    expect(fetchMock).toHaveBeenCalledOnce();
    // The 30s request deadline has passed, but its timer has not run yet.
    const late = performance.now() + 30000;
    vi.spyOn(performance, "now").mockImplementation(() => late);
    release(reply);
    await advanceRenderTurns();
    await pending;
    expect(reply.username).toBeNull();
    expect(win.__sorng_synology_login.getStatus()).toEqual({
      phase: "timeout",
      reason: "timeout",
    });
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
    await advanceRenderTurns();
    expect(next).toHaveBeenCalledOnce();
    expect(
      (document.querySelector('[name="username"]') as HTMLInputElement).value,
    ).toBe(username);
    expect(
      (document.querySelector('[name="password"]') as HTMLInputElement).value,
    ).toBe("");
    expect(fetchMock).toHaveBeenCalledOnce();
    showPassword();
    await advanceRenderTurns();
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
    await advanceRenderTurns();
    expect(next).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      (document.querySelector('[name="password"]') as HTMLInputElement).value,
    ).toBe("");

    showPassword();
    await advanceRenderTurns();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledOnce();
    expect(
      (document.querySelector('[name="current-password"]') as HTMLInputElement)
        .value,
    ).toBe(password);
  });
  it.each(["foreign-action", "wrong-user", "captcha", "other-route"])(
    "refuses %s without requesting the password",
    async (attack) => {
      const pending = begin();
      await advanceRenderTurns();
      showPassword(false);
      if (attack === "foreign-action")
        document
          .querySelector("form")!
          .setAttribute("action", "https://other.invalid/");
      if (attack === "wrong-user")
        (
          document.querySelector('[name="username"]') as HTMLInputElement
        ).value = "other";
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
      expect(win.__sorng_synology_login.getStatus()).toEqual({
        phase: "stopped",
        reason: {
          "foreign-action": "unsafe-form-target",
          "wrong-user": "account-mismatch",
          captcha: "captcha-required",
          "other-route": "interactive-step-required",
        }[attack],
      });
    },
  );
  it("re-acquires a replaced login root before requesting the password and clicks the current Sign in once", async () => {
    const pending = begin();
    await advanceRenderTurns();
    showPassword(false);
    document.querySelector("#sds-login-vue")!.outerHTML =
      document.querySelector("#sds-login-vue")!.outerHTML;
    const signIn = vi.fn();
    document
      .querySelector('[syno-id="password-panel-next-btn"]')!
      .addEventListener("click", signIn);
    route("#/signin/password");
    await advanceRenderTurns();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signIn).toHaveBeenCalledOnce();
    // The original button's listener went away with the replaced root.
    expect(submit).not.toHaveBeenCalled();
    expect(
      (document.querySelector('[name="current-password"]') as HTMLInputElement)
        .value,
    ).toBe(password);
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
    await advanceRenderTurns();
    showPassword(false);
    const field = document.querySelector('[name="current-password"]')!;
    field.setAttribute("disabled", "");
    route("#/signin/password");
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).toHaveBeenCalledOnce();
    field.removeAttribute("disabled");
    await advanceRenderTurns();
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(submit).toHaveBeenCalledOnce();
  });
  function latePassword() {
    let release!: (value: unknown) => void;
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
    return (value: unknown) => release(value);
  }
  it.each(["cancel", "navigation", "route-aba", "action"])(
    "refuses a late password response after %s",
    async (change) => {
      const release = latePassword();
      const reply = { loginFlow: "synology", password };
      const pending = begin();
      await advanceRenderTurns();
      showPassword();
      await advanceRenderTurns();
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
      release({ ok: true, json: async () => reply });
      await advanceRenderTurns();
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
  it("fills a late password response into a replaced reviewed field once", async () => {
    const release = latePassword();
    const reply = { loginFlow: "synology", password };
    const pending = begin();
    await advanceRenderTurns();
    showPassword();
    await advanceRenderTurns();
    const control = document.querySelector('[name="current-password"]')!;
    control.replaceWith(control.cloneNode(true));
    release({ ok: true, json: async () => reply });
    await advanceRenderTurns();
    await pending;
    const current = document.querySelector(
      '[name="current-password"]',
    ) as HTMLInputElement;
    expect(current).not.toBe(control);
    expect(current.value).toBe(password);
    expect(reply.password).toBeNull();
    expect(submit).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("removes its unsent password if an input handler changes the captured form", async () => {
    const pending = begin();
    await advanceRenderTurns();
    showPassword(false);
    const field = document.querySelector(
      '[name="current-password"]',
    ) as HTMLInputElement;
    field.addEventListener("input", () =>
      field.form!.setAttribute("action", "https://other.invalid/"),
    );
    route("#/signin/password");
    await advanceRenderTurns();
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
      await advanceRenderTurns();
      if (reason === "cancel") win.__sorng_autologin.cancel();
      if (reason === "password-error") showPassword();
      await vi.advanceTimersByTimeAsync(reason === "timeout" ? 86000 : 26000);
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
