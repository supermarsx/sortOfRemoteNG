import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";
import { INSTAGRAM_LOGIN_SELECTORS } from "../../src/utils/connection/instagramProfile";

// Synthetic declared profile contract, NOT a captured Instagram page. Public
// Public HTML was a React shell without form inputs; the web-tool fetch was
// rate-limited. No account/API is accessed and hydrated markup is unverified.
const source = loadAutologinClient();
const selectors = {
  username: 'form input[name="username"]',
  password: 'form input[name="password"][type="password"]',
  submit: 'form button[type="submit"]',
};
const credentials = () => ({
  username: "fixture-user",
  password: "fixture-secret",
});
type Result = { ok: boolean; reason: string };
type Client = {
  fetchCredsAndRun(nonce: string, selectors: object): Promise<Result>;
  attempt(creds: object, selectors: object): Result;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
let nativeSubmit: ReturnType<typeof vi.spyOn>;
let requestSubmit: ReturnType<typeof vi.spyOn>;
const originalUrl = location.href;

function mount(reactReady = true) {
  document.body.innerHTML = `<form>
    <input name="csrfmiddlewaretoken" type="hidden" value="site-owned-token">
    <input name="username" autocomplete="username">
    <input name="password" type="password" autocomplete="current-password">
    <button type="submit" disabled>Log in</button>
    <a href="/accounts/password/reset/">Forgot password?</a>
    <button type="button">Log in with Facebook</button>
  </form><a href="/accounts/emailsignup/">Sign up</a>`;
  const form = document.querySelector("form")!;
  const user = form.querySelector<HTMLInputElement>('[name="username"]')!;
  const pw = form.querySelector<HTMLInputElement>('[name="password"]')!;
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const token = form.querySelector<HTMLInputElement>('[type="hidden"]')!;
  const ordinarySetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!;
  const patchedSetter = vi.fn();
  for (const field of [user, pw]) {
    Object.defineProperty(field, "value", {
      configurable: true,
      get: () => ordinarySetter.get!.call(field),
      set: (value: string) => {
        patchedSetter(value);
        ordinarySetter.set!.call(field, value);
      },
    });
    if (reactReady)
      field.addEventListener("input", () => {
        if (user.value && pw.value)
          setTimeout(() => {
            button.disabled = false;
          }, 250);
      });
  }
  const submitted: Record<string, FormDataEntryValue>[] = [];
  const login = vi.fn((event: Event) => {
    event.preventDefault();
    submitted.push(Object.fromEntries(new FormData(form)));
  });
  form.addEventListener("submit", login);
  const alternative = vi.fn();
  form.querySelector('[type="button"]')!.addEventListener("click", alternative);
  const click = vi.spyOn(button, "click");
  return {
    form,
    user,
    pw,
    button,
    token,
    patchedSetter,
    submitted,
    login,
    alternative,
    click,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/accounts/login/");
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
  Object.defineProperty(window, "__sorng_map_navigation", {
    configurable: true,
    writable: true,
    value: (url: string) =>
      url.replace("https://www.instagram.com", location.origin),
  });
  fetchMock = vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({ ...credentials(), selectors }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  nativeSubmit = vi
    .spyOn(HTMLFormElement.prototype, "submit")
    .mockImplementation(() => {});
  requestSubmit = vi
    .spyOn(HTMLFormElement.prototype, "requestSubmit")
    .mockImplementation(() => {});
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
  ])
    Reflect.deleteProperty(window, key);
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  document.querySelectorAll("base").forEach((node) => node.remove());
  history.replaceState({}, "", originalUrl);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function run() {
  const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
  await vi.advanceTimersByTimeAsync(9000);
  return pending;
}

describe("Instagram ordinary-form adapter", () => {
  it("uses exactly the frontend's declared selectors", () => {
    expect(selectors).toEqual({
      username: INSTAGRAM_LOGIN_SELECTORS.usernameSelector,
      password: INSTAGRAM_LOGIN_SELECTORS.passwordSelector,
      submit: INSTAGRAM_LOGIN_SELECTORS.submitSelector,
    });
  });
  it("fills controlled inputs, waits for the site's enabled button and clicks once without changing handlers or tokens", async () => {
    const page = mount();
    const original = page.form.outerHTML;
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.user.value).toBe("fixture-user");
    expect(page.pw.value).toBe("fixture-secret");
    expect(page.button.disabled).toBe(true);
    expect(page.click).not.toHaveBeenCalled();
    expect(page.patchedSetter).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(page.login).toHaveBeenCalledOnce();
    expect(page.click).toHaveBeenCalledOnce();
    expect(page.submitted).toEqual([
      { ...credentials(), csrfmiddlewaretoken: "site-owned-token" },
    ]);
    expect(page.token.value).toBe("site-owned-token");
    expect(page.form.outerHTML).toBe(original.replace(' disabled=""', ""));
    expect(nativeSubmit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(page.alternative).not.toHaveBeenCalled();
    await client.fetchCredsAndRun("repeat", selectors);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.click).toHaveBeenCalledOnce();
  });

  it("waits without redeeming while input controls are disabled", async () => {
    const page = mount();
    page.user.disabled = true;
    page.pw.disabled = true;
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
    page.user.disabled = false;
    page.pw.disabled = false;
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(page.login).toHaveBeenCalledOnce();
  });

  it("cancels native default GET without stopping the website submit listener, then removes its guard", async () => {
    const page = mount();
    page.form.removeEventListener("submit", page.login);
    const observed: boolean[] = [];
    // This site listener deliberately does NOT call preventDefault itself.
    const websiteListener = vi.fn((event: Event) =>
      observed.push(event.defaultPrevented),
    );
    page.form.addEventListener("submit", websiteListener);
    expect(page.form.method).toBe("get");
    await run();
    expect(page.click).toHaveBeenCalledOnce();
    expect(websiteListener).toHaveBeenCalledOnce();
    expect(observed).toEqual([true]);
    expect(nativeSubmit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    // Synthetic dispatch does not navigate; it proves the temporary capturing
    // guard was removed without unregistering the original website listener.
    const later = new Event("submit", { bubbles: true, cancelable: true });
    expect(page.form.dispatchEvent(later)).toBe(true);
    expect(observed).toEqual([true, false]);
  });

  it("never forces a disabled submit or retries a missing React response", async () => {
    const page = mount(false);
    expect(await run()).toMatchObject({
      ok: false,
      reason: "form-not-found-timeout",
    });
    page.button.disabled = false;
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.click).not.toHaveBeenCalled();
    expect(nativeSubmit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.pw.value).toBe("");
  });

  it("cancels while waiting for React and never clicks after later enablement", async () => {
    const page = mount(false);
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(200);
    client.cancel();
    expect(await pending).toMatchObject({ ok: false, reason: "cancelled" });
    expect(page.pw.value).toBe("");
    expect(page.user.value).toBe("fixture-user");
    page.button.disabled = false;
    await vi.advanceTimersByTimeAsync(10000);
    expect(page.click).not.toHaveBeenCalled();
  });

  it.each(["cancel", "failure"])(
    "preserves a user-edited password on %s",
    async (kind) => {
      const page = mount(false);
      const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
      await vi.advanceTimersByTimeAsync(200);
      expect(page.pw.value).toBe("fixture-secret");
      page.pw.value = "user-edited-password";
      if (kind === "cancel") client.cancel();
      await vi.advanceTimersByTimeAsync(10000);
      expect(await pending).toMatchObject({ ok: false });
      expect(page.pw.value).toBe("user-edited-password");
      expect(page.click).not.toHaveBeenCalled();
    },
  );

  it("clears an owned password when the form becomes unsafe after input", async () => {
    const page = mount();
    page.pw.addEventListener("input", () => {
      page.form.action = "https://evil.test/";
    });
    expect(await run()).toMatchObject({ ok: false });
    expect(page.pw.value).toBe("");
    expect(page.click).not.toHaveBeenCalled();
  });

  it("does not disclose credentials to a form replaced during the nonce fetch", async () => {
    const page = mount();
    fetchMock.mockImplementation(async () => {
      page.user.value = "user-started-typing";
      return { ok: true, json: async () => credentials() };
    });
    expect(await run()).toMatchObject({ ok: false });
    expect(page.user.value).toBe("user-started-typing");
    expect(page.pw.value).toBe("");
    expect(page.click).not.toHaveBeenCalled();
  });

  it.each([
    "/challenge/",
    "/checkpoint/",
    "/accounts/signup/",
    "/accounts/password/reset/",
    "/accounts/onetap/",
    "/accounts/login/?next=/challenge/",
    "/accounts/login/?oauth=1",
  ])("does not redeem on alternate stage %s", async (path) => {
    const page = mount();
    history.replaceState({}, "", path);
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.pw.value).toBe("");
    expect(page.click).not.toHaveBeenCalled();
  });

  it.each([
    "hidden username",
    "hidden password",
    "hidden ancestor",
    "duplicate username",
    "duplicate password",
    "duplicate submit",
    "foreign action",
    "foreign base",
    "signup action",
    "GET method",
    "foreign target",
    "override action",
    "OTP",
    "challenge dialog",
    "error alert",
    "extra visible field",
    "already username",
    "already password",
    "unproved origin",
  ])("rejects %s before credential redemption", async (kind) => {
    const page = mount();
    switch (kind) {
      case "hidden username":
        page.user.type = "hidden";
        break;
      case "hidden password":
        page.pw.hidden = true;
        break;
      case "hidden ancestor":
        page.form.hidden = true;
        break;
      case "duplicate username":
        page.form.insertAdjacentHTML(
          "beforeend",
          '<input name="username" type="hidden">',
        );
        break;
      case "duplicate password":
        page.form.insertAdjacentHTML(
          "beforeend",
          '<input name="password" type="hidden">',
        );
        break;
      case "duplicate submit":
        page.form.insertAdjacentHTML(
          "beforeend",
          '<button type="submit" hidden>decoy</button>',
        );
        break;
      case "foreign action":
        page.form.action = "https://evil.test/accounts/login/";
        break;
      case "foreign base":
        document.head.insertAdjacentHTML(
          "beforeend",
          '<base href="https://evil.test/">',
        );
        page.form.setAttribute("action", "/accounts/login/");
        break;
      case "signup action":
        page.form.action = "/accounts/signup/";
        break;
      case "GET method":
        page.form.method = "get";
        break;
      case "foreign target":
        page.form.target = "_blank";
        break;
      case "override action":
        page.button.setAttribute("formaction", "/accounts/login/");
        break;
      case "OTP":
        page.form.insertAdjacentHTML(
          "beforeend",
          '<input autocomplete="one-time-code">',
        );
        break;
      case "challenge dialog":
        page.form.insertAdjacentHTML(
          "beforeend",
          '<div role="dialog">Verification required</div>',
        );
        break;
      case "error alert":
        page.form.insertAdjacentHTML(
          "beforeend",
          '<div role="alert">Rejected login</div>',
        );
        break;
      case "extra visible field":
        page.form.insertAdjacentHTML("beforeend", '<input name="extra">');
        break;
      case "already username":
        page.user.value = "someone-else";
        break;
      case "already password":
        page.pw.value = "already-filled";
        break;
      case "unproved origin":
        Reflect.deleteProperty(window, "__sorng_map_navigation");
        break;
    }
    const before = page.pw.value;
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.pw.value).toBe(before);
    expect(page.click).not.toHaveBeenCalled();
  });

  it.each([
    "replace password",
    "foreign action",
    "challenge",
    "clear controlled value",
  ])("stops during input events on %s without reacquiring", async (kind) => {
    const page = mount();
    page.user.addEventListener("input", () => {
      if (kind === "replace password")
        page.pw.replaceWith(page.pw.cloneNode(true));
      if (kind === "foreign action") page.form.action = "https://evil.test/";
      if (kind === "challenge")
        page.form.insertAdjacentHTML(
          "beforeend",
          '<input autocomplete="one-time-code">',
        );
      if (kind === "clear controlled value") page.user.value = "";
    });
    expect(await run()).toMatchObject({ ok: false });
    expect(page.click).not.toHaveBeenCalled();
    expect(page.login).not.toHaveBeenCalled();
    expect(nativeSubmit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });

  it("does not retry after a site handler leaves an error form in place", async () => {
    const page = mount();
    page.form.addEventListener("submit", () => {
      page.form.insertAdjacentHTML(
        "beforeend",
        '<div role="alert">Try again</div>',
      );
    });
    await run();
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.click).toHaveBeenCalledOnce();
    expect(page.login).toHaveBeenCalledOnce();
  });

  it("rejects the synchronous legacy entrypoint", () => {
    const page = mount();
    expect(client.attempt(credentials(), selectors)).toMatchObject({
      ok: false,
      reason: "form-readiness-required",
    });
    expect(page.user.value).toBe("");
    expect(page.pw.value).toBe("");
    expect(page.click).not.toHaveBeenCalled();
  });
});
