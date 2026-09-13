import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import { DEFAULT_HTTP_FORM_AUTOMATION } from "../../src/utils/connection/httpFormAutomation";
import type { HttpApplicationSettings } from "../../src/types/connection/connection";

// Synthetic control-only fixtures, not copies of Joomla's templates or live
// login acceptance. Reviewed official administrator/modules/mod_login/tmpl/default.php:
// https://github.com/joomla/joomla-cms/blob/3.10.12/administrator/modules/mod_login/tmpl/default.php
// https://github.com/joomla/joomla-cms/blob/4.1.5/administrator/modules/mod_login/tmpl/default.php
// https://github.com/joomla/joomla-cms/blob/4.4.13/administrator/modules/mod_login/tmpl/default.php
// https://github.com/joomla/joomla-cms/blob/5.4.8/administrator/modules/mod_login/tmpl/default.php
// https://github.com/joomla/joomla-cms/blob/6.1.3/administrator/modules/mod_login/tmpl/default.php
const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
type Result = { ok: boolean; reason: string };
type Credentials = { username: string | null; password: string | null };
type Client = {
  bootstrap(
    creds: Credentials,
    selectors: object,
    options?: unknown,
  ): Promise<Result>;
  attempt(creds: Credentials, selectors: object): Result;
  fetchCredsAndRun(
    nonce: string,
    selectors: object,
  ): Promise<Result | undefined>;
  cancel(): void;
};
type Version = HttpApplicationSettings["joomlaVersion"];
let client: Client;
const originalUrl = window.location.href;
const credentials = (): Credentials => ({
  username: "fixture-admin",
  password: "fixture-password",
});
const field = (name: string) =>
  document.querySelector<HTMLInputElement>(`#form-login [name="${name}"]`)!;
const form = () => document.querySelector<HTMLFormElement>("#form-login")!;
function selectors(version: Version = "auto") {
  const login = resolveHttpApplicationLogin({
    protocol: "https",
    hostname: "joomla.test",
    username: "fixture-admin",
    password: "fixture-password",
    httpApplication: {
      version: 1,
      id: "joomla",
      loginMode: "form",
      loginPath: "/staff-entry/",
      joomlaVersion: version,
    },
  });
  return {
    username: login.selectors!.usernameSelector,
    password: login.selectors!.passwordSelector,
    submit: login.selectors!.submitSelector,
  };
}
function show(version = "6.1.3", extra = "") {
  document.body.innerHTML = `<form id="form-login" method="post" action="/administrator/index.php">
    <input id="mod-login-username" name="username" autocomplete="username">
    <input id="mod-login-password" name="passwd" type="password" autocomplete="current-password">
    <button type="button" class="input-password-toggle">Show password</button>
    <button type="button" id="plg-webauthn-login">Security key</button>${extra}
    ${version.startsWith("3") ? '<button class="login-button">Log in</button>' : '<button id="btn-login-submit" type="submit">Log in</button>'}
    <input type="hidden" name="option" value="com_login">
    <input type="hidden" name="task" value="login">
    <input type="hidden" name="return" value="fixture-return">
    <input type="hidden" name="fixture-random-csrf" value="1">
  </form><form id="other"><input type="password" name="other-password"></form>`;
  exposeControls();
  const submit = vi.fn((event: Event) => event.preventDefault());
  form().addEventListener("submit", submit);
  const otherClick = vi.fn();
  document
    .querySelectorAll('button[type="button"]')
    .forEach((button) => button.addEventListener("click", otherClick));
  return { submit, otherClick };
}
function exposeControls() {
  for (const element of document.querySelectorAll("input,button"))
    Object.defineProperty(element, "offsetParent", {
      configurable: true,
      get: () => document.body,
    });
}
const challenge =
  '<input id="mod-login-secretkey" name="secretkey" autocomplete="one-time-code" type="text">';
const options = (patch: object) => ({
  ...DEFAULT_HTTP_FORM_AUTOMATION,
  fields: [],
  ...patch,
});

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({}, "", "/staff-entry/");
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
  document.querySelectorAll("base").forEach((base) => base.remove());
  window.history.replaceState({}, "", originalUrl);
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("reviewed Joomla administrator password forms", () => {
  it.each([
    ["3.10.12", "3"],
    ["4.1.5", "4"],
    ["4.4.13", "4"],
    ["5.4.8", "5"],
    ["6.1.3", "6"],
    ["3.10.12", "auto"],
    ["4.1.5", "auto"],
    ["4.4.13", "auto"],
    ["5.4.8", "auto"],
    ["6.1.3", "auto"],
  ] as const)(
    "submits %s with selection %s once, preserving the real action and CSRF",
    async (template, version) => {
      const { submit, otherClick } = show(template);
      const creds = credentials();
      expect(await client.bootstrap(creds, selectors(version))).toMatchObject({
        ok: true,
        reason: "submitted",
      });
      expect(submit).toHaveBeenCalledOnce();
      expect(otherClick).not.toHaveBeenCalled();
      expect(form().getAttribute("action")).toBe("/administrator/index.php");
      expect(field("username").value).toBe("fixture-admin");
      expect(field("passwd").value).toBe("fixture-password");
      expect(field("option").value).toBe("com_login");
      expect(field("task").value).toBe("login");
      expect(field("return").value).toBe("fixture-return");
      expect(field("fixture-random-csrf").value).toBe("1");
      expect(
        document.querySelector<HTMLInputElement>("#other input")!.value,
      ).toBe("");
      expect(creds).toEqual({ username: null, password: null });
      await vi.advanceTimersByTimeAsync(10000);
      expect(submit).toHaveBeenCalledOnce();
    },
  );

  it.each(["3.10.12", "4.1.5"])(
    "fills %s legacy two-factor form for manual completion without interpreting the code",
    async (version) => {
      const { submit, otherClick } = show(version, challenge);
      field("secretkey").value = "fixture-user-entered-security-token";
      const creds = credentials();
      expect(await client.bootstrap(creds, selectors())).toMatchObject({
        ok: false,
        reason: "manual-mfa-required",
      });
      expect(submit).not.toHaveBeenCalled();
      expect(otherClick).not.toHaveBeenCalled();
      expect(field("secretkey").value).toBe(
        "fixture-user-entered-security-token",
      );
      expect(field("passwd").value).toBe("fixture-password");
      expect(form().querySelector('[role="status"]')?.textContent).toContain(
        "then select Log in",
      );
      expect(creds).toEqual({ username: null, password: null });
      await vi.advanceTimersByTimeAsync(10000);
      expect(submit).not.toHaveBeenCalled();
      // The user can still intentionally complete the site's original POST.
      form().querySelector<HTMLButtonElement>(selectors().submit!)!.click();
      expect(submit).toHaveBeenCalledOnce();
      expect(field("fixture-random-csrf").value).toBe("1");
    },
  );

  it.each(["", 'style="display:none"', "disabled"])(
    "does not send an empty or hidden/disabled legacy challenge (%s)",
    async (attributes) => {
      const { submit } = show(
        "3.10.12",
        challenge.replace('type="text"', `type="text" ${attributes}`),
      );
      expect(await client.bootstrap(credentials(), selectors())).toMatchObject({
        reason: "manual-mfa-required",
      });
      expect(field("secretkey").value).toBe("");
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it("also pauses the synchronous legacy client entrypoint", () => {
    const { submit } = show("3.10.12", challenge);
    expect(client.attempt(credentials(), selectors())).toMatchObject({
      reason: "manual-mfa-required",
    });
    expect(submit).not.toHaveBeenCalled();
    expect(field("passwd").value).toBe("fixture-password");
  });

  it.each(["action", "target"])(
    "stops the synchronous Joomla entrypoint before password fill when an input event changes %s",
    (kind) => {
      const { submit } = show("3.10.12", challenge);
      field("username").addEventListener("input", () => {
        if (kind === "action") form().action = "https://foreign.test/";
        else form().target = "_top";
      });
      expect(client.attempt(credentials(), selectors())).toMatchObject({
        reason: "form-changed-or-unsafe",
      });
      expect(field("passwd").value).toBe("");
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it.each(["input", "delay"])(
    "detects a legacy challenge rendered during %s before any submit",
    async (when) => {
      const { submit } = show("4.1.5");
      const add = () => form().insertAdjacentHTML("beforeend", challenge);
      if (when === "input")
        field("username").addEventListener("input", add, { once: true });
      const pending = client.bootstrap(
        credentials(),
        selectors(),
        options({ submitDelayMs: 100 }),
      );
      if (when === "delay") add();
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toMatchObject({ reason: "manual-mfa-required" });
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it("does not auto-submit if the initial challenge disappears during a fill event", async () => {
    const { submit } = show("3.10.12", challenge);
    field("username").addEventListener(
      "input",
      () => field("secretkey").remove(),
      { once: true },
    );
    expect(await client.bootstrap(credentials(), selectors())).toMatchObject({
      reason: "manual-mfa-required",
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("keeps explicit fill-only mode without a misleading submitted result", async () => {
    const { submit } = show("3.10.12", challenge);
    expect(
      await client.bootstrap(
        credentials(),
        selectors(),
        options({ submit: false }),
      ),
    ).toEqual({ ok: true, reason: "filled-only" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("clears one-shot endpoint credentials after manual handoff and never fetches/retries again", async () => {
    const { submit } = show("4.1.5", challenge);
    const response = {
      ...credentials(),
      selectors: {
        username_selector: selectors().username,
        password_selector: selectors().password,
        submit_selector: selectors().submit,
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal("fetch", fetch);
    expect(await client.fetchCredsAndRun("fixture-nonce", {})).toMatchObject({
      reason: "manual-mfa-required",
    });
    expect(response.username).toBeNull();
    expect(response.password).toBeNull();
    await client.fetchCredsAndRun("fixture-second-nonce", {});
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetch).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
  });

  it.each(["4", "5", "6"] as const)(
    "never fills Joomla %s captive email/TOTP or security-key controls",
    async (version) => {
      // The core TOTP/email providers share these attributes; their opaque
      // record_id is not an authenticator-method proof. Desktop toolbar submit
      // forwards to a hidden mobile button; neither is selected automatically.
      document.body.innerHTML =
        '<form id="users-mfa-captive-form" action="/administrator/index.php?option=com_users&task=captive.validate&record_id=17" method="post"><input name="code" id="users-mfa-code" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6"><input name="fixture-random-csrf" type="hidden" value="1"><button type="submit" id="users-mfa-captive-button-submit" style="display:none">Verify</button><button type="button" id="plg-webauthn-login">Security key</button></form>';
      exposeControls();
      const clicks = vi.fn();
      document
        .querySelectorAll("button")
        .forEach((button) => button.addEventListener("click", clicks));
      const creds = credentials();
      const pending = client.bootstrap(creds, selectors(version));
      await vi.advanceTimersByTimeAsync(9000);
      expect(await pending).toMatchObject({
        ok: false,
        reason: "form-not-found-timeout",
      });
      expect(
        document.querySelector<HTMLInputElement>('[name="code"]')!.value,
      ).toBe("");
      expect(clicks).not.toHaveBeenCalled();
      expect(creds).toEqual({ username: null, password: null });
    },
  );

  it.each([
    "form-action",
    "button-action",
    "method",
    "button-method",
    "form-target",
    "button-target",
    "named-target",
    "base-target",
  ])("refuses unsafe Joomla %s before filling", async (kind) => {
    const { submit } = show();
    const button = form().querySelector<HTMLButtonElement>(
      selectors().submit!,
    )!;
    if (kind === "form-action") form().action = "https://foreign.test/login";
    if (kind === "button-action")
      button.setAttribute("formaction", "https://foreign.test/login");
    if (kind === "method") form().method = "get";
    if (kind === "button-method") button.setAttribute("formmethod", "get");
    if (kind === "form-target") form().target = "_top";
    if (kind === "button-target") button.formTarget = "_blank";
    if (kind === "named-target") form().target = "other-window";
    if (kind === "base-target")
      document.head.insertAdjacentHTML("beforeend", '<base target="_parent">');
    expect((await client.bootstrap(credentials(), selectors())).ok).toBe(false);
    expect(field("username").value).toBe("");
    expect(field("passwd").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
  });

  it("honors an explicit safe button target overriding a form/base target", async () => {
    const { submit } = show();
    form().target = "_blank";
    document.head.insertAdjacentHTML("beforeend", '<base target="_top">');
    form().querySelector<HTMLButtonElement>(selectors().submit!)!.formTarget =
      "_self";
    expect(await client.bootstrap(credentials(), selectors())).toMatchObject({
      reason: "submitted",
    });
    expect(submit).toHaveBeenCalledOnce();
  });

  it.each([
    ["form", null],
    ["form", ""],
    ["form", "invalid"],
    ["button", ""],
    ["button", "invalid"],
  ] as const)(
    "refuses effective GET from %s method %j before filling",
    async (owner, value) => {
      const { submit } = show();
      const element =
        owner === "form"
          ? form()
          : form().querySelector<HTMLButtonElement>(selectors().submit!)!;
      const attribute = owner === "form" ? "method" : "formmethod";
      if (value === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, value);
      expect(await client.bootstrap(credentials(), selectors())).toMatchObject({
        reason: "unsafe-form-method",
      });
      expect(field("passwd").value).toBe("");
      expect(submit).not.toHaveBeenCalled();
    },
  );

  it("preserves an explicit button POST overriding form GET", async () => {
    const { submit } = show();
    form().method = "get";
    form()
      .querySelector<HTMLButtonElement>(selectors().submit!)!
      .setAttribute("formmethod", "POST");
    expect(await client.bootstrap(credentials(), selectors())).toMatchObject({
      reason: "submitted",
    });
    expect(submit).toHaveBeenCalledOnce();
  });

  it.each([
    "action",
    "target",
    "base",
    "method",
    "removed-method",
    "empty-override",
    "replacement",
  ])("rechecks %s changes during the submit delay", async (kind) => {
    const { submit } = show();
    const pending = client.bootstrap(
      credentials(),
      selectors(),
      options({ submitDelayMs: 100 }),
    );
    if (kind === "action") form().action = "https://foreign.test/login";
    if (kind === "target") form().target = "_blank";
    if (kind === "base")
      document.head.insertAdjacentHTML("beforeend", '<base target="_top">');
    if (kind === "method") form().method = "get";
    if (kind === "removed-method") form().removeAttribute("method");
    if (kind === "empty-override")
      form()
        .querySelector<HTMLButtonElement>(selectors().submit!)!
        .setAttribute("formmethod", "");
    if (kind === "replacement")
      field("passwd").replaceWith(field("passwd").cloneNode());
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-changed-or-unsafe",
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it("stops before password fill if a username event changes the form origin", async () => {
    const { submit } = show("4.1.5", challenge);
    field("username").addEventListener("input", () => {
      form().action = "https://foreign.test/";
    });
    expect(await client.bootstrap(credentials(), selectors())).toMatchObject({
      reason: "form-changed-or-unsafe",
    });
    expect(field("passwd").value).toBe("");
    expect(submit).not.toHaveBeenCalled();
    expect(form().querySelector('[role="status"]')).toBeNull();
  });
});
