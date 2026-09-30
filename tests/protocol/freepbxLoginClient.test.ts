import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import { DEFAULT_HTTP_FORM_AUTOMATION } from "../../src/utils/connection/httpFormAutomation";

// Reduced source-reviewed fixtures, not live FreePBX acceptance. Admin source:
// https://github.com/FreePBX/framework/blob/90929231b801d865556a57875ddd25a74d283f8d/amp_conf/htdocs/admin/views/login.php
// https://github.com/FreePBX/framework/blob/90929231b801d865556a57875ddd25a74d283f8d/amp_conf/htdocs/admin/assets/js/script.legacy.js
// UCP uses a separate POST form with a token and a different submit control:
// https://github.com/FreePBX/ucp/blob/release/17.0/htdocs/views/login.php
const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
type Credentials = { username: string | null; password: string | null };
type Client = {
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
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  window.history.replaceState({}, "", originalUrl);
  vi.clearAllTimers();
  vi.useRealTimers();
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
