import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VODAFONE_SMART_ROUTER_LOGIN_SELECTORS } from "../../src/utils/connection/vodafoneSmartRouterProfile";
import { loadAutologinClient } from "../helpers/autologinAsset";

const source = loadAutologinClient();
const selectors = {
  username_selector: VODAFONE_SMART_ROUTER_LOGIN_SELECTORS.usernameSelector,
  password_selector: VODAFONE_SMART_ROUTER_LOGIN_SELECTORS.passwordSelector,
  submit_selector: VODAFONE_SMART_ROUTER_LOGIN_SELECTORS.submitSelector,
};
const credentials = () => ({
  username: "fixture-user",
  password: "fixture+&=password",
});
type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors: object,
  ): Promise<{ ok: boolean; reason: string; via?: string }>;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;

function mount() {
  // Supplied login contract: these controls are deliberately NOT inside a form.
  document.body.innerHTML = `<div id="mainbody">
    <div class="logodiv"><div id="ontImg" class="ontimages"></div></div>
    <div id="logindiv">
      <div id="welcomdiv"><span id="logintitle" class="welcomspan" bindtext="frame028">Bem-vindo</span></div>
      <div class="loginrow"><input id="username" placeholder="Nome de utilizador" type="text" class="inputdiv"></div>
      <div class="loginrow">
        <input id="userpwd" placeholder="Password" type="password" class="inputdiv">
        <input type="button" id="loginbtn" class="button button-apply" name="login" bindtext="frame007a" onclick="SubmitForm();" value="Iniciar Sessão">
      </div>
      <div class="loginrow" id="error-message" style="display: none;"><div id="DivErrPage" style="color: #e60000;"></div></div>
    </div>
  </div>`;
  const user = document.querySelector<HTMLInputElement>("#username")!;
  const pw = document.querySelector<HTMLInputElement>("#userpwd")!;
  const button = document.querySelector<HTMLInputElement>("#loginbtn")!;
  const submitted: ReturnType<typeof credentials>[] = [];
  const login = vi.fn(() =>
    submitted.push({ username: user.value, password: pw.value }),
  );
  Reflect.set(window, "SubmitForm", login);
  // Model the supplied inline event in jsdom while preserving its attribute.
  button.onclick = () => Reflect.get(window, "SubmitForm")();
  return { user, pw, button, login, submitted };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.hidden || this.style.display === "none") return null;
      for (let el = this.parentElement; el; el = el.parentElement) {
        if (el.hidden || el.style.display === "none") return null;
      }
      return document.body;
    },
  );
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ...credentials(), selectors }),
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
  for (const name of ["__sorng_autologin", "__autologin_last", "SubmitForm"])
    Reflect.deleteProperty(window, name);
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function run() {
  const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
  await vi.advanceTimersByTimeAsync(10000);
  return pending;
}

describe("Vodafone Smart Router 3 login", () => {
  it("fills the supplied controls and clicks the site's SubmitForm button exactly once", async () => {
    const page = mount();
    const click = vi.spyOn(page.button, "click");
    const nativeSubmit = vi
      .spyOn(HTMLFormElement.prototype, "submit")
      .mockImplementation(() => {});
    const requestSubmit = vi
      .spyOn(HTMLFormElement.prototype, "requestSubmit")
      .mockImplementation(() => {});
    expect(page.pw.form).toBeNull();
    expect(await run()).toMatchObject({
      ok: true,
      reason: "submitted",
      via: "vodafone-router-button-click",
    });
    expect(page.submitted).toEqual([credentials()]);
    expect(click).toHaveBeenCalledOnce();
    expect(page.login).toHaveBeenCalledOnce();
    expect(nativeSubmit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/__sortofremoteng_autologin?nonce=fixture-nonce",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    await client.fetchCredsAndRun("second-nonce", selectors);
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.login).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each(["handler", "button", "document"])(
    "waits for %s readiness without fetching secrets early",
    async (kind) => {
      const page = mount();
      if (kind === "handler") Reflect.deleteProperty(window, "SubmitForm");
      if (kind === "button") page.button.disabled = true;
      if (kind === "document")
        Object.defineProperty(document, "readyState", {
          configurable: true,
          value: "loading",
        });
      const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).not.toHaveBeenCalled();
      Reflect.set(window, "SubmitForm", page.login);
      page.button.disabled = false;
      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "complete",
      });
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
      expect(page.submitted).toEqual([credentials()]);
    },
  );

  it.each([
    "wrong-container",
    "missing-password",
    "readonly",
    "disabled-fieldset",
    "hidden",
    "inert",
    "busy",
    "duplicate-user",
    "duplicate-container",
    "native-form",
    "form-association",
    "formaction",
    "formmethod",
    "formtarget",
    "submit-type",
    "wrong-handler",
    "missing-handler",
    "blocked-inline-handler",
    "visible-error",
  ])("does not release credentials for %s", async (kind) => {
    const page = mount();
    const container = document.querySelector<HTMLElement>("#logindiv")!;
    switch (kind) {
      case "wrong-container":
        container.id = "configuration";
        break;
      case "missing-password":
        page.pw.remove();
        break;
      case "readonly":
        page.pw.readOnly = true;
        break;
      case "disabled-fieldset": {
        const fieldset = document.createElement("fieldset");
        fieldset.disabled = true;
        container.append(fieldset);
        fieldset.append(page.user, page.pw, page.button);
        break;
      }
      case "hidden":
        container.hidden = true;
        break;
      case "inert":
        container.setAttribute("inert", "");
        break;
      case "busy":
        container.setAttribute("aria-busy", "true");
        break;
      case "duplicate-user":
        document.body.prepend(page.user.cloneNode());
        break;
      case "duplicate-container":
        document.body.append(container.cloneNode(true));
        break;
      case "native-form": {
        const form = document.createElement("form");
        container.before(form);
        form.append(container);
        break;
      }
      case "form-association":
        page.button.setAttribute("form", "foreign-form");
        break;
      case "formaction":
        page.button.setAttribute("formaction", "https://foreign.example/login");
        break;
      case "formmethod":
        page.button.setAttribute("formmethod", "get");
        break;
      case "formtarget":
        page.button.setAttribute("formtarget", "_blank");
        break;
      case "submit-type":
        page.button.type = "submit";
        break;
      case "wrong-handler":
        page.button.setAttribute("onclick", "ResetRouter();");
        break;
      case "missing-handler":
        Reflect.deleteProperty(window, "SubmitForm");
        break;
      case "blocked-inline-handler":
        page.button.onclick = null;
        break;
      case "visible-error":
        document.querySelector<HTMLElement>("#error-message")!.style.display =
          "block";
        document.querySelector("#DivErrPage")!.textContent = "Invalid password";
        break;
    }
    expect(await run()).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.user.value).toBe("");
    expect(page.pw.value).toBe("");
    expect(page.login).not.toHaveBeenCalled();
  });

  it.each(["handler", "button", "container"])(
    "cancels if %s changes while filling",
    async (kind) => {
      const page = mount();
      const otherHandler = vi.fn();
      page.user.addEventListener("input", () => {
        if (kind === "handler") Reflect.set(window, "SubmitForm", otherHandler);
        if (kind === "button") page.button.onclick = otherHandler;
        if (kind === "container")
          document.querySelector("#logindiv")!.id = "settings";
      });
      expect(await run()).toMatchObject({
        ok: false,
        reason: "form-changed-or-unsafe",
      });
      expect(page.pw.value).toBe("");
      expect(page.login).not.toHaveBeenCalled();
      expect(otherHandler).not.toHaveBeenCalled();
    },
  );

  it("cancels waiting without redeeming a nonce", async () => {
    const page = mount();
    page.button.disabled = true;
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(200);
    client.cancel();
    page.button.disabled = false;
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ ok: false, reason: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.login).not.toHaveBeenCalled();
  });

  it("does not fill or submit after the credential endpoint rejects the nonce", async () => {
    const page = mount();
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await run();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.user.value).toBe("");
    expect(page.pw.value).toBe("");
    expect(page.login).not.toHaveBeenCalled();
  });

  it("does not retry a rejected login or touch unrelated controls", async () => {
    const page = mount();
    const reset = document.createElement("button");
    reset.textContent = "Reset router";
    const resetClick = vi.fn();
    reset.onclick = resetClick;
    document.body.append(reset);
    page.login.mockImplementation(() => {
      document.querySelector<HTMLElement>("#error-message")!.style.display =
        "block";
      document.querySelector("#DivErrPage")!.textContent = "Invalid password";
      return 0;
    });
    await run();
    await client.fetchCredsAndRun("second-nonce", selectors);
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.login).toHaveBeenCalledOnce();
    expect(resetClick).not.toHaveBeenCalled();
  });
});
