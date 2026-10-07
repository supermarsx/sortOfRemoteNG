import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPNSENSE_LOGIN_SELECTORS } from "../../src/utils/connection/opnsenseProfile";
import { loadAutologinClient } from "../helpers/autologinAsset";

// Synthetic DOM representing the reviewed WebGUI authgui.inc/csrf.inc contract.
// No firewall, real account, cookie or token is contacted or copied by this test.
const source = loadAutologinClient();
const selectors = {
  username_selector: OPNSENSE_LOGIN_SELECTORS.usernameSelector,
  password_selector: OPNSENSE_LOGIN_SELECTORS.passwordSelector,
  submit_selector: OPNSENSE_LOGIN_SELECTORS.submitSelector,
};
const credentials = () => ({
  username: "fixture-admin",
  password: "fixture+&=password",
});
type Result = { ok: boolean; reason: string; via?: string };
type Client = {
  fetchCredsAndRun(nonce: string, selectors: object): Promise<Result>;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
const originalUrl = location.href;

function mount() {
  document.body.className = "page-login";
  document.body.innerHTML = `<main class="login-modal-container"><div class="login-modal-content">
    <div id="inputerrors">&nbsp;</div>
    <form class="clearfix" id="iform" name="iform" method="post" autocomplete="off">
      <input type="hidden" name="fixtureRandomCsrfKey" value="fixtureCsrfToken" autocomplete="new-password">
      <input id="usernamefld" name="usernamefld" type="text" class="form-control user">
      <input id="passwordfld" name="passwordfld" type="password" class="form-control pwd">
      <button type="submit" name="login" value="1" class="btn btn-primary pull-right">Login</button>
    </form>
    <div class="login-sso-link-container"><a href="/sso">SSO</a></div>
  </div></main>`;
  const form = document.querySelector("form")!;
  const user = document.querySelector<HTMLInputElement>("#usernamefld")!;
  const pw = document.querySelector<HTMLInputElement>("#passwordfld")!;
  const button = form.querySelector("button")!;
  const posted: Record<string, FormDataEntryValue>[] = [];
  const submit = vi.fn((event: Event) => {
    event.preventDefault();
    const submitter = (event as SubmitEvent).submitter;
    posted.push(Object.fromEntries(new FormData(form, submitter)));
  });
  form.addEventListener("submit", submit);
  return { form, user, pw, button, posted, submit };
}

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/");
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[hidden]") ? null : document.body;
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
  Reflect.deleteProperty(window, "__sorng_autologin");
  Reflect.deleteProperty(window, "__autologin_last");
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  document.body.className = "";
  history.replaceState({}, "", originalUrl);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function run() {
  const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
  await vi.advanceTimersByTimeAsync(15000);
  return pending;
}

describe("OPNsense login through the existing generic auto-login client", () => {
  it.each(["/", "/index.php", "/index.php?url=%2Fui%2Fcore%2Fdashboard"])(
    "clicks the native POST submitter once at %s, preserving CSRF and login=1",
    async (path) => {
      history.replaceState({}, "", path);
      const page = mount();
      const nativeSubmit = vi
        .spyOn(HTMLFormElement.prototype, "submit")
        .mockImplementation(() => {});
      const requestSubmit = vi
        .spyOn(HTMLFormElement.prototype, "requestSubmit")
        .mockImplementation(() => {});
      expect(await run()).toMatchObject({
        ok: true,
        reason: "submitted",
        via: "override-submit",
      });
      expect(page.posted).toEqual([
        {
          usernamefld: credentials().username,
          passwordfld: credentials().password,
          fixtureRandomCsrfKey: "fixtureCsrfToken",
          login: "1",
        },
      ]);
      expect(nativeSubmit).not.toHaveBeenCalled();
      expect(requestSubmit).not.toHaveBeenCalled();
      await client.fetchCredsAndRun("second-nonce", selectors);
      await vi.advanceTimersByTimeAsync(60000);
      expect(page.submit).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        "/__sortofremoteng_autologin?nonce=fixture-nonce",
        expect.objectContaining({
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    },
  );

  it("waits for enabled controls without releasing credentials early", async () => {
    const page = mount();
    page.button.disabled = true;
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    page.button.disabled = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(page.submit).toHaveBeenCalledOnce();
  });

  it.each([
    "other-page",
    "other-form",
    "GET",
    "readonly",
    "disabled-fieldset",
    "hidden",
    "pfsense-submitter",
    "missing-login-value",
    "external-target",
    "formaction-override",
    "formmethod-override",
    "formtarget-override",
  ])("does not redeem credentials for %s", async (kind) => {
    const page = mount();
    switch (kind) {
      case "other-page":
        document.body.className = "settings-page";
        break;
      case "other-form":
        page.form.id = "user-settings";
        break;
      case "GET":
        page.form.method = "get";
        break;
      case "readonly":
        page.pw.readOnly = true;
        break;
      case "disabled-fieldset": {
        const fieldset = document.createElement("fieldset");
        fieldset.disabled = true;
        page.form.append(fieldset);
        fieldset.append(page.user, page.pw, page.button);
        break;
      }
      case "hidden":
        page.pw.hidden = true;
        break;
      case "pfsense-submitter":
        page.button.outerHTML =
          '<input type="submit" name="login" value="Login">';
        break;
      case "missing-login-value":
        page.button.removeAttribute("value");
        break;
      case "external-target":
        page.form.target = "_blank";
        break;
      case "formaction-override":
        page.button.setAttribute("formaction", "https://foreign.example/login");
        break;
      case "formmethod-override":
        page.button.setAttribute("formmethod", "get");
        break;
      case "formtarget-override":
        page.button.setAttribute("formtarget", "_blank");
        break;
    }
    expect(await run()).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.user.value).toBe("");
    expect(page.pw.value).toBe("");
    expect(page.submit).not.toHaveBeenCalled();
  });

  it.each([
    "https://foreign.example/login",
    "http://foreign.example/login",
    `${location.protocol}//${location.hostname}:9443/login`,
    `${location.origin.replace("://", "://fixture-user:fixture-password@")}/login`,
  ])(
    "rejects foreign POST destination %s before fetching credentials",
    async (action) => {
      const page = mount();
      page.form.action = action;
      expect(await run()).toMatchObject({
        ok: false,
        reason: "unsafe-form-action",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(page.pw.value).toBe("");
      expect(page.submit).not.toHaveBeenCalled();
    },
  );

  it("preserves an explicit empty action as a POST to the current page", async () => {
    history.replaceState({}, "", "/index.php?url=%2Fui%2Fcore%2Fdashboard");
    const page = mount();
    page.form.setAttribute("action", "");
    expect(await run()).toMatchObject({ ok: true, reason: "submitted" });
    expect(page.form.getAttribute("action")).toBe("");
    expect(page.form.action).toBe(location.href);
    expect(page.form.method).toBe("post");
    expect(page.posted).toEqual([
      {
        usernamefld: credentials().username,
        passwordfld: credentials().password,
        fixtureRandomCsrfKey: "fixtureCsrfToken",
        login: "1",
      },
    ]);
  });

  it("does not submit if the destination changes during input events", async () => {
    const page = mount();
    page.user.addEventListener("input", () => {
      page.form.action = "https://foreign.example/login";
    });
    expect(await run()).toMatchObject({
      ok: false,
      reason: "form-changed-or-unsafe",
    });
    expect(page.pw.value).toBe("");
    expect(page.submit).not.toHaveBeenCalled();
  });

  it("does not fill or submit if the credential endpoint rejects the nonce", async () => {
    const page = mount();
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    await run();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.user.value).toBe("");
    expect(page.pw.value).toBe("");
    expect(page.submit).not.toHaveBeenCalled();
  });
});
