import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import { DEFAULT_HTTP_FORM_AUTOMATION } from "../../src/utils/connection/httpFormAutomation";

// Reduced source-reviewed fixtures, not live FreePBX acceptance. Admin source:
// https://github.com/FreePBX/framework/blob/90929231b801d865556a57875ddd25a74d283f8d/amp_conf/htdocs/admin/views/login.php
// https://github.com/FreePBX/framework/blob/90929231b801d865556a57875ddd25a74d283f8d/amp_conf/htdocs/admin/assets/js/script.legacy.js
// UCP uses a separate POST form with a token and a different submit control:
// https://github.com/FreePBX/ucp/blob/release/17.0/htdocs/views/login.php

describe("FreePBX launcher routing proof", () => {
  const current = "0123456789abcdef0123456789abcdef";
  const stale = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  function router(result?: string) {
    const route = vi.fn(
      (url: string) => result ?? url + "?__sorng_generation_v1=" + current,
    );
    Object.defineProperty(window, "__sorng_map_navigation", {
      configurable: true,
      value: route,
    });
    return route;
  }
  it.each([
    "__sorng_generation_v1=" + current,
    "__sorng_navigation_v1=" + current,
    "__sorng_generation_v1=" + current + "&__sorng_navigation_v1=" + current,
  ])("allows only current internal proof: %s", async (query) => {
    const fixture = mountLauncher();
    const route = router();
    fixture.launcher.search = "?" + query;
    const pending = client.fetchCredsAndRun("nonce", selectors());
    expect(fixture.click).toHaveBeenCalledOnce();
    expect(route).toHaveBeenCalledWith(location.origin + "/admin/");
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(fixture.continueClick).toHaveBeenCalledOnce();
    expect(fixture.launcher.search).toBe("?" + query);
  });

  it.each([
    "__sorng_generation_v1=" + stale,
    "__sorng_navigation_v1=" + stale,
    "__sorng_generation_v1=" + current + "&__sorng_navigation_v1=" + stale,
    "__sorng_generation_v1=" + current + "&__sorng_generation_v1=" + current,
    "__sorng_navigation_v1=" + current + "&__sorng_navigation_v1=" + current,
    "__sorng_generation_v1=bad",
    "__sorng_generation_v1=" + current.toUpperCase(),
    "__sorng_generation_v1=" + current + "&action=logout",
    "__sorng_generation_v1=" + current + "&",
    "__sorng_%67eneration_v1=" + current,
    "__sorng_generation_v1=%30" + current.slice(1),
    "__sorng_popup_parent_v1=1",
  ])(
    "rejects stale, duplicate, malformed or unknown query: %s",
    async (query) => {
      const fixture = mountLauncher(null);
      router();
      fixture.launcher.search = "?" + query;
      const pending = client.fetchCredsAndRun("nonce", selectors());
      await vi.advanceTimersByTimeAsync(20000);
      expect(await pending).toMatchObject({
        ok: false,
        reason: "form-not-found-timeout",
      });
      expect(fixture.click).not.toHaveBeenCalled();
      expect(fixture.fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "unstamped", "foreign", "throws"] as const)(
    "stays strict if current proof cannot be established: %s",
    async (mode) => {
      const fixture = mountLauncher(null);
      fixture.launcher.search = "?__sorng_generation_v1=" + current;
      if (mode === "unstamped") router(location.origin + "/admin/");
      if (mode === "foreign")
        router(
          "https://foreign.invalid/admin/?__sorng_generation_v1=" + current,
        );
      if (mode === "throws")
        router().mockImplementation(() => {
          throw new Error("closed");
        });
      const pending = client.fetchCredsAndRun("nonce", selectors());
      await vi.advanceTimersByTimeAsync(20000);
      expect(await pending).toMatchObject({ ok: false });
      expect(fixture.click).not.toHaveBeenCalled();
      expect(fixture.fetchMock).not.toHaveBeenCalled();
    },
  );
});

function mountLauncher(delay: number | null = 400) {
  mount(false);
  const launcher = document.querySelector<HTMLAnchorElement>("#login_admin")!;
  launcher.href = new URL("/admin/", location.origin).href;
  launcher.className = "login_item";
  launcher.style.backgroundImage = "url(assets/images/sys-admin.png)";
  launcher.innerHTML = "&nbsp;";
  Object.defineProperty(launcher, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
  const submit = vi.fn((event: Event) => event.preventDefault());
  const continueClick = vi.fn();
  const open = () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="ui-dialog">' + adminForm + "</div>",
    );
    const form = document.querySelector<HTMLFormElement>(".ui-dialog form")!;
    for (const field of form.querySelectorAll("input,button"))
      Object.defineProperty(field, "offsetParent", {
        configurable: true,
        get: () => document.body,
      });
    form.addEventListener("submit", submit);
    form.querySelector("button")!.addEventListener("click", () => {
      continueClick();
      form.requestSubmit();
    });
  };
  const click = vi.fn(() => {
    if (delay !== null) setTimeout(open, delay);
  });
  launcher.addEventListener("click", click);
  const fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...login().credentials!, selectors: selectors() }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return { launcher, click, submit, continueClick, fetchMock, open };
}

describe("FreePBX reviewed admin launcher", () => {
  it("clicks the supplied same-authority launcher once and waits before credential redemption", async () => {
    const fixture = mountLauncher();
    const pending = client.fetchCredsAndRun("nonce", selectors());
    expect(fixture.click).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLInputElement>(
        "#login_form input[name=password]",
      )!.value,
    ).toBe("");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(fixture.fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/__sortofremoteng_autologin?nonce=nonce",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(fixture.continueClick).toHaveBeenCalledOnce();
    expect(fixture.submit).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLInputElement>(
        ".ui-dialog input[name=password]",
      )!.value,
    ).toBe("fixture-password");
    expect(
      document.querySelector<HTMLInputElement>(
        "#login_form input[name=password]",
      )!.value,
    ).toBe("");
    expect(
      document.querySelector<HTMLInputElement>(
        "#frm-login input[name=password]",
      )!.value,
    ).toBe("");
    await client.fetchCredsAndRun("nonce", selectors());
    await vi.advanceTimersByTimeAsync(10000);
    expect(fixture.click).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).toHaveBeenCalledOnce();
  });

  it("also opens the launcher for the direct bootstrap entry point", async () => {
    const fixture = mountLauncher();
    const pending = run();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(fixture.click).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("never reopens a present dialog, including fields that are still disabled", async () => {
    const fixture = mountLauncher(null);
    fixture.open();
    const password = document.querySelector<HTMLInputElement>(
      ".ui-dialog input[name=password]",
    )!;
    password.disabled = true;
    const pending = client.fetchCredsAndRun("nonce", selectors());
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.click).not.toHaveBeenCalled();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    password.disabled = false;
    await vi.advanceTimersByTimeAsync(400);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(fixture.click).not.toHaveBeenCalled();
  });

  it.each([
    "https://unapproved.invalid/admin/",
    "//unapproved.invalid/admin/",
    "http://user:password@localhost/admin/",
    "/ucp/",
    "/admin/?action=logout",
    "javascript:void(0)",
  ])("does not click an unsafe or different destination: %s", async (href) => {
    const fixture = mountLauncher(null);
    fixture.launcher.setAttribute("href", href);
    const pending = client.fetchCredsAndRun("nonce", selectors());
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-not-found-timeout",
    });
    expect(fixture.click).not.toHaveBeenCalled();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("requires the exact reviewed selector set", async () => {
    const fixture = mountLauncher(null);
    const pending = client.fetchCredsAndRun("nonce", {
      ...selectors(),
      username: ".other-user",
    });
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toMatchObject({ ok: false });
    expect(fixture.click).not.toHaveBeenCalled();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("times out after one launch without redeeming credentials or retrying the click", async () => {
    const fixture = mountLauncher(null);
    const pending = client.fetchCredsAndRun("nonce", selectors());
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-not-found-timeout",
    });
    expect(fixture.click).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it("cancels while waiting for the modal without redeeming credentials", async () => {
    const fixture = mountLauncher();
    const pending = client.fetchCredsAndRun("nonce", selectors());
    client.cancel();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ ok: false, reason: "cancelled" });
    expect(fixture.click).toHaveBeenCalledOnce();
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    expect(fixture.continueClick).not.toHaveBeenCalled();
  });

  it("refuses an unsafe modal action before fetching credentials", async () => {
    const fixture = mountLauncher(null);
    const pending = client.fetchCredsAndRun("nonce", selectors());
    fixture.open();
    document
      .querySelector(".ui-dialog form")!
      .setAttribute("action", "https://unapproved.invalid/steal");
    await vi.advanceTimersByTimeAsync(400);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "unsafe-form-action",
    });
    expect(fixture.fetchMock).not.toHaveBeenCalled();
    expect(fixture.continueClick).not.toHaveBeenCalled();
  });
});

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
type Credentials = { username: string | null; password: string | null };
type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors: object,
  ): Promise<{ ok: boolean; reason: string }>;
  bootstrap(
    credentials: Credentials,
    selectors: object,
    options?: unknown,
  ): Promise<{ ok: boolean; reason: string }>;
  cancel(): void;
};
let client: Client;
const originalUrl = window.location.href;
const login = (loginMode: "form" | "manual" = "form") =>
  resolveHttpApplicationLogin({
    protocol: "https",
    hostname: "pbx.example.test",
    username: "fixture-admin",
    password: "fixture-password",
    httpAutoLogin: true,
    httpApplication: { version: 1, id: "freepbx", loginMode },
  });
const selectors = () => {
  const value = login().selectors!;
  return {
    username: value.usernameSelector,
    password: value.passwordSelector,
    submit: value.submitSelector,
  };
};
const adminForm = `<form id="loginform" method="post" role="form">
  <input type="text" name="username" autocomplete="off">
  <input type="password" name="password" autocomplete="off">
  <button type="button" id="customContinue">Continue</button>
  <button type="button" id="customCancel">Cancel</button>
</form>`;
const ucpForm = `<form id="frm-login" method="POST" action="?display=dashboard">
  <input type="hidden" name="token" value="site-token">
  <input type="text" name="username"><input type="password" name="password">
  <button type="submit" id="btn-login">Login</button>
  <button type="button" id="btn-forgot">Reset</button>
</form>`;
function mount(showDialog = true, mfa = false) {
  document.body.innerHTML = `<div id="login_form" style="display:none">${adminForm}</div>
    <a href="#" id="login_admin">FreePBX Administration</a>${ucpForm}
    ${showDialog ? `<div class="ui-dialog">${adminForm}</div>` : ""}`;
  for (const element of document.querySelectorAll("input,button")) {
    Object.defineProperty(element, "offsetParent", {
      configurable: true,
      get: () => (element.closest("#login_form") ? null : document.body),
    });
  }
  const form = document.querySelector<HTMLFormElement>(".ui-dialog form");
  const submit = vi.fn((event: Event) => event.preventDefault());
  const continueClick = vi.fn(() => {
    // Model the site's Continue handler: either its MFA hook, or native POST.
    if (mfa) {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<div id="mfa-challenge"><input autocomplete="one-time-code" name="otp" value=""><button>Verify</button></div>',
      );
    } else form!.requestSubmit();
  });
  form?.addEventListener("submit", submit);
  form
    ?.querySelector('[id="customContinue"]')
    ?.addEventListener("click", continueClick);
  const otherClick = vi.fn();
  document
    .querySelectorAll("#customCancel, #btn-login, #btn-forgot, #login_admin")
    .forEach((element) => element.addEventListener("click", otherClick));
  return { form, submit, continueClick, otherClick };
}
const run = (options?: unknown) =>
  client.bootstrap({ ...login().credentials! }, selectors(), options);

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({}, "", "/admin/");
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
  Reflect.deleteProperty(window, "__sorng_map_navigation");
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  window.history.replaceState({}, "", originalUrl);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("production login client with FreePBX Administration dialog", () => {
  it("clicks Continue once on the live dialog, leaving the hidden template and UCP untouched", async () => {
    const { form, submit, continueClick, otherClick } = mount();
    const credentials = { ...login().credentials! };
    expect(await client.bootstrap(credentials, selectors())).toMatchObject({
      ok: true,
      reason: "submitted",
    });
    expect(
      form!.querySelector<HTMLInputElement>('[name="username"]')!.value,
    ).toBe("fixture-admin");
    expect(
      form!.querySelector<HTMLInputElement>('[name="password"]')!.value,
    ).toBe("fixture-password");
    expect(form!.hasAttribute("action")).toBe(false);
    expect(submit).toHaveBeenCalledOnce();
    expect(continueClick).toHaveBeenCalledOnce();
    expect(otherClick).not.toHaveBeenCalled();
    for (const input of document.querySelectorAll<HTMLInputElement>(
      '#login_form input, #frm-login input:not([type="hidden"])',
    ))
      expect(input.value).toBe("");
    expect(
      document.querySelector<HTMLInputElement>('[name="token"]')!.value,
    ).toBe("site-token");
    expect(credentials).toEqual({ username: null, password: null });
    await vi.advanceTimersByTimeAsync(10000);
    expect(continueClick).toHaveBeenCalledOnce();
  });

  it.each(["action", "formaction"])(
    "rejects an external %s before filling or clicking",
    async (attribute) => {
      const { form, continueClick } = mount();
      const target =
        attribute === "action"
          ? form!
          : form!.querySelector('[id="customContinue"]')!;
      target.setAttribute(attribute, "https://unrelated.example.test/steal");
      expect(await run()).toMatchObject({ ok: false });
      expect(
        form!.querySelector<HTMLInputElement>('[name="password"]')!.value,
      ).toBe("");
      expect(
        form!.querySelector<HTMLInputElement>('[name="username"]')!.value,
      ).toBe("");
      expect(continueClick).not.toHaveBeenCalled();
    },
  );

  it("leaves the landing page and UCP interactive when no admin dialog is open", async () => {
    const { otherClick } = mount(false);
    const pending = run();
    await vi.advanceTimersByTimeAsync(9000);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-not-found-timeout",
    });
    for (const input of document.querySelectorAll<HTMLInputElement>(
      'input:not([type="hidden"])',
    ))
      expect(input.value).toBe("");
    expect(otherClick).not.toHaveBeenCalled();
  });

  it("keeps the site's MFA hook in charge without submitting or guessing a code", async () => {
    const { submit, continueClick } = mount(true, true);
    expect(await run()).toMatchObject({ ok: true, reason: "submitted" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(continueClick).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLInputElement>('[name="otp"]')!.value,
    ).toBe("");
  });

  it("supports fill-only without invoking the site's Continue handler", async () => {
    const { form, continueClick, submit } = mount();
    expect(
      await run({ ...DEFAULT_HTTP_FORM_AUTOMATION, fields: [], submit: false }),
    ).toMatchObject({ ok: true, reason: "filled-only" });
    expect(
      form!.querySelector<HTMLInputElement>('[name="password"]')!.value,
    ).toBe("fixture-password");
    expect(continueClick).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not arm automation in manual mode even with legacy autologin enabled", () => {
    const { form, continueClick } = mount();
    expect(login("manual")).toEqual({
      credentials: null,
      autoLogin: false,
      upstreamAuthMode: "none",
    });
    expect(
      form!.querySelector<HTMLInputElement>('[name="password"]')!.value,
    ).toBe("");
    expect(continueClick).not.toHaveBeenCalled();
  });
});
