import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RD_WEB_LOGIN_SELECTORS } from "../../src/utils/connection/rdWebProfile";
import { loadAutologinClient } from "../helpers/autologinAsset";

// Synthetic classic-form fixtures from the documented field/POST contract,
// not a captured authenticated session or a claim of live server acceptance.
const source = loadAutologinClient();
const selectors = {
  username: RD_WEB_LOGIN_SELECTORS.usernameSelector,
  password: RD_WEB_LOGIN_SELECTORS.passwordSelector,
  submit: RD_WEB_LOGIN_SELECTORS.submitSelector,
};
type Result = { ok: boolean; reason: string; via?: string };
type Client = {
  fetchCredsAndRun(nonce: string, selectors: object): Promise<Result>;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
let username: string;
let formAutomation: object | undefined;
const password = "fixture-password";
const originalUrl = location.href;

function mount(locale = "en-US") {
  history.replaceState({}, "", `/RDWeb/Pages/${locale}/login.aspx`);
  document.body.innerHTML = `<form id="FrmLogin" name="FrmLogin" method="post" action="login.aspx?ReturnUrl=%2FRDWeb%2FPages%2F${locale}%2FDefault.aspx">
    <input type="hidden" name="isUtf8" value="1">
    <input type="hidden" name="flags" value="0">
    <input type="hidden" name="ClaimsToken" value="fixture-token">
    <input type="radio" name="MachineType" value="public" checked>
    <input type="radio" name="MachineType" value="private">
    <input id="DomainUserName" name="DomainUserName" type="text" autocomplete="off">
    <input id="UserPass" name="UserPass" type="password" autocomplete="off">
    <input id="btnSignIn" type="submit" value="Sign in">
  </form>`;
  const form = document.querySelector<HTMLFormElement>("form")!;
  const user = document.querySelector<HTMLInputElement>("#DomainUserName")!;
  const pw = document.querySelector<HTMLInputElement>("#UserPass")!;
  const button = document.querySelector<HTMLInputElement>("#btnSignIn")!;
  const submitted = vi.fn();
  // Like onLoginFormSubmit, the site's handler owns hidden-state preparation.
  const siteHandler = vi.fn((event: Event) => {
    event.preventDefault();
    form.querySelector<HTMLInputElement>('[name="flags"]')!.value = "4";
    submitted(Object.fromEntries(new FormData(form)));
  });
  form.addEventListener("submit", siteHandler);
  return {
    form,
    user,
    pw,
    button,
    siteHandler,
    submitted,
    click: vi.spyOn(button, "click"),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  username = "EXAMPLE\\fixture-user";
  formAutomation = undefined;
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.closest('[hidden], [style="display:none"]')
        ? null
        : document.body;
    },
  );
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ username, password, selectors, formAutomation }),
  }));
  vi.stubGlobal("fetch", fetchMock);
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
  document.querySelectorAll("base").forEach((element) => element.remove());
  history.replaceState({}, "", originalUrl);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function run() {
  const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
  await vi.advanceTimersByTimeAsync(11000);
  return pending;
}

describe("classic RDWeb guarded automatic login", () => {
  it.each([
    ["en-US", "EXAMPLE\\fixture-user"],
    ["pt-PT", "fixture-user@example.test"],
    ["de-DE", "fixture-user"],
  ])(
    "submits the site's localized %s form once with the exact %s account",
    async (locale, account) => {
      username = account;
      const page = mount(locale);
      const nativeSubmit = vi
        .spyOn(HTMLFormElement.prototype, "submit")
        .mockImplementation(() => {});
      const requestSubmit = vi
        .spyOn(HTMLFormElement.prototype, "requestSubmit")
        .mockImplementation(() => {});
      const action = page.form.getAttribute("action");
      expect(await run()).toMatchObject({
        ok: true,
        reason: "submitted",
        via: "override-submit",
      });
      expect(page.user.value).toBe(account);
      expect(page.pw.value).toBe(password);
      expect(page.click).toHaveBeenCalledOnce();
      expect(page.siteHandler).toHaveBeenCalledOnce();
      expect(page.submitted).toHaveBeenCalledWith({
        DomainUserName: account,
        UserPass: password,
        isUtf8: "1",
        flags: "4",
        ClaimsToken: "fixture-token",
        MachineType: "public",
      });
      expect(page.form.getAttribute("action")).toBe(action);
      expect(nativeSubmit).not.toHaveBeenCalled();
      expect(requestSubmit).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        "/__sortofremoteng_autologin?nonce=fixture-nonce",
        expect.objectContaining({
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
      window.eval(source);
      await client.fetchCredsAndRun("second-nonce", selectors);
      await vi.advanceTimersByTimeAsync(60000);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(page.click).toHaveBeenCalledOnce();
      expect(
        JSON.stringify(
          (window as unknown as { __autologin_last: Result }).__autologin_last,
        ),
      ).not.toContain(password);
    },
  );

  it("accepts the proxy's same-origin absolute form action", async () => {
    const page = mount();
    page.form.action = new URL(
      page.form.getAttribute("action")!,
      location.href,
    ).href;
    expect(await run()).toMatchObject({ ok: true });
    expect(page.click).toHaveBeenCalledOnce();
  });

  it("preserves an explicitly selected private-computer option", async () => {
    const page = mount();
    page.form.querySelector<HTMLInputElement>('[value="private"]')!.checked =
      true;
    expect(await run()).toMatchObject({ ok: true });
    expect(page.submitted).toHaveBeenCalledWith(
      expect.objectContaining({ MachineType: "private" }),
    );
    expect(
      page.form.querySelector<HTMLInputElement>('[value="private"]')!.checked,
    ).toBe(true);
  });

  it("waits for RDWeb's initially hidden login table before redeeming credentials", async () => {
    const page = mount();
    page.form.hidden = true;
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    page.form.hidden = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ ok: true });
    expect(page.click).toHaveBeenCalledOnce();
  });

  it.each([
    "GET",
    "missing method",
    "foreign action",
    "foreign base",
    "password change",
    "form target",
    "submit action",
    "submit method",
    "submit target",
    "external form owner",
    "missing username",
    "missing password",
    "missing submit",
    "wrong credential name",
    "disabled username",
    "readonly password",
    "disabled submit",
    "disabled fieldset",
    "OTP",
    "second password",
    "challenge iframe",
    "CAPTCHA",
    "HTML5",
    "Entra",
  ])("does not redeem or fill for %s", async (kind) => {
    const page = mount();
    switch (kind) {
      case "GET":
        page.form.method = "get";
        break;
      case "missing method":
        page.form.removeAttribute("method");
        break;
      case "foreign action":
        page.form.action = "https://evil.test/login.aspx";
        break;
      case "foreign base":
        document.head.insertAdjacentHTML(
          "beforeend",
          '<base href="https://evil.test/">',
        );
        break;
      case "password change":
        page.form.action = "password.aspx";
        break;
      case "form target":
        page.form.target = "_blank";
        break;
      case "submit action":
        page.button.setAttribute("formaction", "login.aspx");
        break;
      case "submit method":
        page.button.setAttribute("formmethod", "get");
        break;
      case "submit target":
        page.button.setAttribute("formtarget", "_blank");
        break;
      case "external form owner":
        page.button.setAttribute("form", "another-form");
        break;
      case "missing username":
        page.user.remove();
        break;
      case "missing password":
        page.pw.remove();
        break;
      case "missing submit":
        page.button.remove();
        break;
      case "wrong credential name":
        page.pw.name = "newPassword";
        break;
      case "disabled username":
        page.user.disabled = true;
        break;
      case "readonly password":
        page.pw.readOnly = true;
        break;
      case "disabled submit":
        page.button.disabled = true;
        break;
      case "disabled fieldset": {
        const fieldset = document.createElement("fieldset");
        fieldset.disabled = true;
        page.form.append(fieldset);
        fieldset.append(page.user, page.pw, page.button);
        break;
      }
      case "OTP":
        page.form.insertAdjacentHTML(
          "beforeend",
          '<input autocomplete="one-time-code">',
        );
        break;
      case "second password":
        page.form.insertAdjacentHTML(
          "beforeend",
          '<input type="password" name="newPassword">',
        );
        break;
      case "challenge iframe":
        page.form.insertAdjacentHTML(
          "beforeend",
          '<iframe title="Verify"></iframe>',
        );
        break;
      case "CAPTCHA":
        page.form.insertAdjacentHTML("beforeend", '<input name="captcha">');
        break;
      case "HTML5":
        page.form.id = "html5Login";
        break;
      case "Entra":
        page.user.id = "i0116";
        page.pw.id = "i0118";
        break;
    }
    expect(await run()).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    expect(page.user.value).toBe("");
    expect(page.pw.value).toBe("");
  });

  it("does not send credentials when the form action changes during input handling", async () => {
    const page = mount();
    page.user.addEventListener("input", () => {
      page.form.action = "https://evil.test/login.aspx";
    });
    expect(await run()).toMatchObject({ ok: false });
    expect(page.pw.value).toBe("");
    expect(page.click).not.toHaveBeenCalled();
  });

  it("preserves password edits during a configured submit delay", async () => {
    const page = mount();
    formAutomation = {
      version: 1,
      submit: true,
      fillDelayMs: 0,
      submitDelayMs: 1000,
      detectionTimeoutMs: 8000,
      fields: [],
    };
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(100);
    expect(page.pw.value).toBe(password);
    page.pw.value = "user-edited-password";
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ ok: false });
    expect(page.pw.value).toBe("user-edited-password");
    expect(page.click).not.toHaveBeenCalled();
  });

  it("never retries after a site handler rejects the attempt", async () => {
    const page = mount();
    page.form.addEventListener("submit", () => {
      page.form.insertAdjacentHTML(
        "beforeend",
        '<p role="alert">Authentication was rejected</p>',
      );
    });
    await run();
    await vi.advanceTimersByTimeAsync(60000);
    await client.fetchCredsAndRun("try-again", selectors);
    expect(page.click).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("cancels a waiting hidden form without redeeming credentials", async () => {
    const page = mount();
    page.form.hidden = true;
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(200);
    client.cancel();
    page.form.hidden = false;
    await vi.advanceTimersByTimeAsync(15000);
    expect(await pending).toMatchObject({ ok: false, reason: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
  });
});
