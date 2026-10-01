import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";
import { EXCHANGE_ECP_LOGIN_SELECTORS } from "../../src/utils/connection/exchangeEcpProfile";

// Synthetic Exchange OWA FBA/ECP contract, not live server acceptance.
// Tests the assembled native asset and actual DOM form serialization.
const source = loadAutologinClient();
const selectors = {
  username_selector: EXCHANGE_ECP_LOGIN_SELECTORS.usernameSelector,
  password_selector: EXCHANGE_ECP_LOGIN_SELECTORS.passwordSelector,
  submit_selector: EXCHANGE_ECP_LOGIN_SELECTORS.submitSelector,
};
const credentials = {
  username: "CONTOSO\\admin",
  password: "fixture+&=secret",
};
type Client = {
  fetchCredsAndRun(nonce: string, selectors: object): Promise<unknown>;
  attempt(creds: object, selectors: object): unknown;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
const originalUrl = location.href;
const entry =
  "/owa/auth/logon.aspx?replaceCurrent=1&url=" + encodeURIComponent("/ecp/");

function mount() {
  document.body.innerHTML = `<form name="logonForm" method="post" action="/owa/auth.owa">
    <input name="destination" type="hidden" value="/ecp/?ExchClientVer=15&amp;test=1">
    <input name="flags" type="hidden" value="4">
    <input name="forcedownlevel" type="hidden" value="0">
    <input name="isUtf8" type="hidden" value="1">
    <input id="username" name="username">
    <input id="password" name="password" type="password">
    <input id="passwordText" name="passwordText" style="display:none">
    <input id="showPasswordCheck" type="checkbox">
    <input name="trusted" type="checkbox">
    <div class="signInError" role="alert"></div>
    <div class="signInEnter"><div onclick="clkLgn()" class="signinbutton" role="button" tabindex="0">Sign in</div></div>
    <div style="display:none"><input type="submit" tabindex="-1"></div>
  </form>`;
  for (const element of document.querySelectorAll(
    "input, .signinbutton, .signInError",
  ))
    Object.defineProperty(element, "offsetParent", {
      configurable: true,
      get: () =>
        element.closest('[style="display:none"]') ? null : document.body,
    });
  const form = document.querySelector("form")!;
  const user = document.querySelector<HTMLInputElement>("#username")!;
  const pw = document.querySelector<HTMLInputElement>("#password")!;
  const destination = form.elements.namedItem(
    "destination",
  ) as HTMLInputElement;
  const button = document.querySelector<HTMLElement>(".signinbutton")!;
  const submitted: Record<string, FormDataEntryValue>[] = [];
  const login = vi.fn(() => {
    submitted.push(Object.fromEntries(new FormData(form)));
  });
  Object.defineProperty(window, "clkLgn", {
    configurable: true,
    writable: true,
    value: login,
  });
  button.onclick = () => (window as unknown as { clkLgn(): void }).clkLgn();
  return { form, user, pw, destination, button, login, submitted };
}

beforeEach(() => {
  vi.useFakeTimers();
  window.history.replaceState({}, "", entry);
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  fetchMock = vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({ ...credentials, selectors }),
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
  for (const key of [
    "__sorng_autologin",
    "__autologin_last",
    "__sorng_map_navigation",
    "clkLgn",
  ])
    Reflect.deleteProperty(window, key);
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  document.querySelectorAll("base").forEach((el) => el.remove());
  window.history.replaceState({}, "", originalUrl);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function run() {
  const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
  await vi.advanceTimersByTimeAsync(9000);
  await pending;
}

describe("Exchange ECP forms login", () => {
  it("guards the synchronous attempt entrypoint against password-field mutation", () => {
    const page = mount();
    page.user.addEventListener("input", () => {
      page.pw.type = "text";
    });
    client.attempt(
      { ...credentials },
      {
        username: EXCHANGE_ECP_LOGIN_SELECTORS.usernameSelector,
        password: EXCHANGE_ECP_LOGIN_SELECTORS.passwordSelector,
        submit: EXCHANGE_ECP_LOGIN_SELECTORS.submitSelector,
      },
    );
    expect(page.pw.value).toBe("");
    expect(page.login).not.toHaveBeenCalled();
  });

  it("supports IIS case-insensitive virtual directories", async () => {
    const page = mount();
    window.history.replaceState({}, "", "/OWA/auth/Logon.aspx");
    page.form.action = "/OWA/auth.owa";
    page.destination.value = "/ECP/?ExchClientVer=15";
    await run();
    expect(page.login).toHaveBeenCalledOnce();
    expect(page.submitted[0].destination).toBe("/ECP/?ExchClientVer=15");
  });

  it("waits for the ECP redirect/form handler then clicks once with all hidden fields intact", async () => {
    window.history.replaceState({}, "", "/ecp/");
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
    window.history.replaceState({}, "", entry);
    const page = mount();
    const click = page.button.onclick;
    page.button.onclick = null;
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
    page.button.onclick = click;
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.login).toHaveBeenCalledOnce();
    expect(page.submitted).toEqual([
      {
        ...credentials,
        destination: "/ecp/?ExchClientVer=15&test=1",
        flags: "4",
        forcedownlevel: "0",
        isUtf8: "1",
        passwordText: "",
      },
    ]);
    expect(
      document.querySelector<HTMLInputElement>("#showPasswordCheck")!.checked,
    ).toBe(false);
    await client.fetchCredsAndRun("repeat", selectors);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.login).toHaveBeenCalledOnce();
  });

  it.each(["relative", "proxy", "upstream"])(
    "accepts a scoped %s ECP return address without changing it",
    async (kind) => {
      const page = mount();
      const suffix = "/ecp/?ExchClientVer=15&test=a%26b";
      page.destination.value =
        (kind === "relative"
          ? ""
          : kind === "proxy"
            ? location.origin
            : "https://mail.example.test") + suffix;
      Object.defineProperty(window, "__sorng_map_navigation", {
        configurable: true,
        value: (url: string) =>
          url.replace("https://mail.example.test", location.origin),
      });
      const before = page.destination.value;
      await run();
      expect(page.login).toHaveBeenCalledOnce();
      expect(page.submitted[0].destination).toBe(before);
    },
  );

  it.each([
    "https://other.example.test/ecp/",
    "//other.example.test/ecp/",
    "https://user:pass@other.example.test/ecp/",
    "javascript:alert(1)",
    "/owa/",
    "/ecp-other/",
    "/ecp/%2f..%2fowa/",
    "/ecp/../owa/",
    "/ecp/../ecp/",
    "/ecp/#secret",
    "",
    "/ecp/\\other",
    "/ecp//other",
  ])(
    "refuses unsafe return destination %s before nonce redemption",
    async (value) => {
      const page = mount();
      page.destination.value = value;
      await run();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(page.login).not.toHaveBeenCalled();
      expect(page.user.value + page.pw.value).toBe("");
    },
  );

  it.each([
    ["method", "get"],
    ["method", ""],
    ["enctype", "text/plain"],
    ["action", "https://other.example.test/owa/auth.owa"],
    ["action", "/collect"],
    ["action", "/owa/auth.owa?target=other"],
    ["target", "_top"],
    ["target", "popup"],
  ])(
    "rejects unsafe form %s=%s before credential fetch",
    async (key, value) => {
      const page = mount();
      page.form.setAttribute(key, value);
      await run();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(page.login).not.toHaveBeenCalled();
    },
  );

  it.each(["destination", "username", "password", "button"])(
    "refuses ambiguous %s",
    async (kind) => {
      const page = mount();
      const element = {
        destination: page.destination,
        username: page.user,
        password: page.pw,
        button: page.button,
      }[kind]!;
      page.form.appendChild(element.cloneNode(true));
      await run();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(page.login).not.toHaveBeenCalled();
    },
  );

  it.each(["mfa", "password-change", "error", "reason", "adfs", "owa"])(
    "leaves %s pages interactive without fetching credentials",
    async (kind) => {
      const page = mount();
      if (kind === "mfa") {
        page.user.autocomplete = "one-time-code";
        page.form.insertAdjacentHTML(
          "beforeend",
          '<input autocomplete="one-time-code">',
        );
        Object.defineProperty(page.form.lastElementChild, "offsetParent", {
          get: () => document.body,
        });
      } else if (kind === "password-change")
        window.history.replaceState({}, "", "/owa/auth/expiredpassword.aspx");
      else if (kind === "error")
        document.querySelector(".signInError")!.textContent =
          "Invalid password";
      else if (kind === "reason")
        window.history.replaceState({}, "", entry + "&reason=2");
      else if (kind === "adfs")
        window.history.replaceState({}, "", "/adfs/ls/");
      else page.destination.value = "/owa/";
      await run();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(page.login).not.toHaveBeenCalled();
    },
  );

  it.each(["destination", "action", "handler", "button", "target", "field"])(
    "aborts if %s changes during input, before writing the password",
    async (kind) => {
      const page = mount();
      page.user.addEventListener("input", () => {
        if (kind === "destination") page.destination.value = "/ecp/?changed=1";
        else if (kind === "action") page.form.action = "/collect";
        else if (kind === "handler")
          Object.defineProperty(window, "clkLgn", { value: vi.fn() });
        else if (kind === "button") page.button.onclick = vi.fn();
        else if (kind === "target") page.form.target = "_top";
        else page.destination.replaceWith(page.destination.cloneNode(true));
      });
      await run();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(page.pw.value).toBe("");
      expect(page.login).not.toHaveBeenCalled();
    },
  );

  it("does not retry rejected credentials or alter the visible error", async () => {
    const page = mount();
    await run();
    document.querySelector(".signInError")!.textContent = "Invalid password";
    await client.fetchCredsAndRun("repeat", selectors);
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.login).toHaveBeenCalledOnce();
    expect(document.querySelector(".signInError")!.textContent).toBe(
      "Invalid password",
    );
  });
});
