import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";
import { PTISP_LOGIN_SELECTORS } from "../../src/utils/connection/ptispProfile";

// Reduced public Vue login component: /static/js/40.3795390781c5148c36d7.js,
// reviewed 2026-09-30. No account, live API calls or provider secrets used.
const source = loadAutologinClient();
const selectors = {
  username_selector: PTISP_LOGIN_SELECTORS.usernameSelector,
  password_selector: PTISP_LOGIN_SELECTORS.passwordSelector,
  submit_selector: PTISP_LOGIN_SELECTORS.submitSelector,
};
const credentials = {
  username: "fixture@example.test",
  password: "fixture-password",
};
type Client = {
  fetchCredsAndRun(nonce: string, selectors: object): Promise<unknown>;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;

function mount() {
  document.body.innerHTML = `<div class="login-form-page"><div id="classic-card">
    <form novalidate>
      <input type="email" autocomplete="email" required>
      <input type="password" autocomplete="password" required>
      <input type="checkbox" id="checkbox2" name="check2">
      <a href="/register">Register</a><button type="submit">Entrar</button>
    </form>
  </div></div>`;
  for (const element of document.querySelectorAll("input,button"))
    Object.defineProperty(element, "offsetParent", {
      configurable: true,
      get: () => document.body,
    });
  const state = { email: "", password: "" };
  const email = document.querySelector<HTMLInputElement>(
    'input[type="email"]',
  )!;
  const password = document.querySelector<HTMLInputElement>(
    'input[type="password"]',
  )!;
  email.addEventListener("input", () => {
    state.email = email.value;
  });
  password.addEventListener("input", () => {
    state.password = password.value;
  });
  const submit = vi.fn((event: Event) => {
    event.preventDefault();
    expect(state).toEqual({
      email: credentials.username,
      password: credentials.password,
    });
  });
  const form = document.querySelector("form")!;
  form.addEventListener("submit", submit);
  return { email, password, form, submit };
}

beforeEach(() => {
  vi.useFakeTimers();
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
  Reflect.deleteProperty(window, "__sorng_autologin");
  Reflect.deleteProperty(window, "__autologin_last");
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("PTisp injected form login", () => {
  it("waits for the lazy-rendered form before redeeming credentials, then submits once", async () => {
    document.body.innerHTML = '<div class="login-form-page"></div>';
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).not.toHaveBeenCalled();
    const page = mount();
    await vi.advanceTimersByTimeAsync(600);
    await pending;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.submit).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLInputElement>("#checkbox2")!.checked,
    ).toBe(false);
    expect(document.querySelector("a")!.getAttribute("href")).toBe("/register");
    await client.fetchCredsAndRun("another-nonce", selectors);
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(page.submit).toHaveBeenCalledOnce();
  });

  it.each(["verification", "unrelated", "partial"])(
    "does not release credentials to the %s stage",
    async (stage) => {
      const page = mount();
      if (stage === "verification")
        page.form.innerHTML =
          '<div class="codesBox">' +
          '<input type="text" maxlength="1" placeholder="_">'.repeat(6) +
          '</div><button type="submit">Entrar</button>';
      else if (stage === "unrelated")
        document.querySelector(".login-form-page")!.className =
          "registration-page";
      else page.password.remove();
      const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
      await vi.advanceTimersByTimeAsync(9000);
      await pending;
      expect(fetchMock).not.toHaveBeenCalled();
      expect(page.submit).not.toHaveBeenCalled();
      expect(page.email.value).toBe("");
    },
  );

  it.each([
    ["action", "https://other.test/collect"],
    ["method", "get"],
  ])(
    "rejects unsafe form %s before fetching any secret",
    async (attribute, value) => {
      const page = mount();
      page.form.setAttribute(attribute, value);
      await client.fetchCredsAndRun("fixture-nonce", selectors);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(page.email.value + page.password.value).toBe("");
      expect(page.submit).not.toHaveBeenCalled();
    },
  );

  it("does not resubmit when an invalid-password response leaves the form visible", async () => {
    const page = mount();
    await client.fetchCredsAndRun("fixture-nonce", selectors);
    const error = document.createElement("p");
    error.textContent = "Invalid email or password";
    page.form.append(error);
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.submit).toHaveBeenCalledOnce();
  });
});
