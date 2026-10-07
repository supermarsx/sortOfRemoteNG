import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";
import { LINKEDIN_LOGIN_SELECTORS } from "../../src/utils/connection/linkedinProfile";

// Minimal synthetic fixtures, not a recorded authenticated session. Form-less
// autocomplete controls and Portuguese Entrar text were inspected on the public
// /login response on 2026-10-06; legacy named POST controls are NOT live verified.
const source = loadAutologinClient();
const selectors = {
  username: LINKEDIN_LOGIN_SELECTORS.usernameSelector,
  password: LINKEDIN_LOGIN_SELECTORS.passwordSelector,
  submit: LINKEDIN_LOGIN_SELECTORS.submitSelector,
};
const credentials = () => ({
  username: "fixture@example.test",
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
const originalUrl = location.href;
function mount(legacy = false, enabled = true) {
  document.body.innerHTML = legacy
    ? `<form method="post" action="/checkpoint/lg/login-submit"><input type="hidden" name="csrfToken" value="fixture-token"><input id="username" name="session_key" autocomplete="username"><input id="password" name="session_password" type="password" autocomplete="current-password"><button type="submit" data-litms-control-urn="login-submit">Sign in</button></form>`
    : `<main><section><div><input type="email" autocomplete="username"></div><div><input type="password" autocomplete="current-password"><button type="button" aria-label="Show password"></button></div><input type="checkbox" checked><button type="button">Entrar</button></section><a href="/signup">Join now</a><button type="button">Sign in with Apple</button></main>`;
  const panel = document.querySelector("form, section")!;
  const user = panel.querySelector<HTMLInputElement>(
    'input[autocomplete="username"]',
  )!;
  const pw = panel.querySelector<HTMLInputElement>('input[type="password"]')!;
  const button = Array.from(panel.querySelectorAll("button")).find((b) =>
    /Sign in|Entrar/.test(b.textContent!),
  )!;
  button.disabled = !enabled;
  const handler = vi.fn((event: Event) => event.preventDefault());
  (legacy ? panel : button).addEventListener(
    legacy ? "submit" : "click",
    handler,
  );
  return { panel, user, pw, button, handler, click: vi.spyOn(button, "click") };
}
beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/login");
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.closest("[hidden]") ? null : document.body;
    },
  );
  Object.defineProperty(window, "__sorng_map_navigation", {
    configurable: true,
    writable: true,
    value: (url: string) =>
      url.replace("https://www.linkedin.com", location.origin),
  });
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
describe("LinkedIn bounded origin-bound login", () => {
  it.each([false, true])(
    "fills and submits once (legacy=%s), retains site tokens and never uses native submit",
    async (legacy) => {
      const page = mount(legacy);
      const native = vi
        .spyOn(HTMLFormElement.prototype, "submit")
        .mockImplementation(() => {});
      const request = vi
        .spyOn(HTMLFormElement.prototype, "requestSubmit")
        .mockImplementation(() => {});
      expect(await run()).toMatchObject({ ok: true, reason: "submitted" });
      expect(page.user.value).toBe(credentials().username);
      expect(page.pw.value).toBe(credentials().password);
      expect(page.handler).toHaveBeenCalledOnce();
      expect(page.click).toHaveBeenCalledOnce();
      expect(native).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      if (legacy)
        expect(
          page.panel.querySelector<HTMLInputElement>('[name="csrfToken"]')!
            .value,
        ).toBe("fixture-token");
      else
        expect(
          page.panel.querySelector<HTMLInputElement>('[type="checkbox"]')!
            .checked,
        ).toBe(true);
      await client.fetchCredsAndRun("again", selectors);
      await vi.advanceTimersByTimeAsync(60000);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(page.click).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        "/__sortofremoteng_autologin?nonce=fixture-nonce",
        expect.objectContaining({
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    },
  );
  it("uses native controlled-input setters and waits for the enabled site button", async () => {
    const page = mount(false, false);
    const native = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!;
    const own = vi.fn();
    Object.defineProperty(page.pw, "value", {
      configurable: true,
      get: () => native.get!.call(page.pw),
      set: own,
    });
    page.pw.addEventListener("input", () =>
      setTimeout(() => {
        page.button.disabled = false;
      }, 300),
    );
    expect(await run()).toMatchObject({ ok: true });
    expect(own).not.toHaveBeenCalled();
    expect(page.click).toHaveBeenCalledOnce();
  });
  it("ignores inactive responsive copies but rejects two active panels", async () => {
    const page = mount();
    const copy = page.panel.cloneNode(true) as HTMLElement;
    copy.hidden = true;
    page.panel.after(copy);
    expect(await run()).toMatchObject({ ok: true });
    expect(
      copy.querySelector<HTMLInputElement>('input[type="password"]')!.value,
    ).toBe("");
  });
  it.each([
    "unbound",
    "wrong mapping",
    "signup",
    "challenge",
    "recovery",
    "query challenge",
    "two panels",
    "duplicate",
    "hidden credential",
    "OTP",
    "iframe",
    "alert",
    "dialog",
    "manual user",
    "manual password",
    "unknown button",
    "disabled input",
    "foreign document base",
    "disabled fieldset",
  ])("does not redeem for %s", async (kind) => {
    const page = mount();
    switch (kind) {
      case "unbound":
        Reflect.deleteProperty(window, "__sorng_map_navigation");
        break;
      case "wrong mapping":
        Object.defineProperty(window, "__sorng_map_navigation", {
          value: () => "https://evil.test/login",
        });
        break;
      case "signup":
        history.replaceState({}, "", "/signup");
        break;
      case "challenge":
        history.replaceState({}, "", "/checkpoint/challenge");
        break;
      case "recovery":
        history.replaceState({}, "", "/uas/request-password-reset");
        break;
      case "query challenge":
        history.replaceState({}, "", "/login?challenge=1");
        break;
      case "two panels":
        page.panel.after(page.panel.cloneNode(true));
        break;
      case "duplicate":
        page.panel.insertAdjacentHTML(
          "beforeend",
          '<input type="password" autocomplete="current-password" hidden>',
        );
        break;
      case "hidden credential":
        page.panel.insertAdjacentHTML(
          "beforeend",
          '<input name="session_password" type="hidden">',
        );
        break;
      case "OTP":
        page.panel.insertAdjacentHTML(
          "beforeend",
          '<input autocomplete="one-time-code">',
        );
        break;
      case "iframe":
        page.panel.insertAdjacentHTML(
          "beforeend",
          '<iframe title="challenge"></iframe>',
        );
        break;
      case "alert":
        page.panel.insertAdjacentHTML(
          "beforeend",
          '<div role="alert">Incorrect password</div>',
        );
        break;
      case "dialog":
        page.panel.insertAdjacentHTML(
          "beforeend",
          '<div role="dialog">Verify</div>',
        );
        break;
      case "manual user":
        page.user.value = "manual@example.test";
        break;
      case "manual password":
        page.pw.value = "manual-secret";
        break;
      case "unknown button":
        page.button.textContent = "Join now";
        break;
      case "disabled input":
        page.user.disabled = true;
        break;
      case "foreign document base":
        document.head.insertAdjacentHTML(
          "beforeend",
          '<base href="https://evil.test/">',
        );
        break;
      case "disabled fieldset": {
        const wrapper = document.createElement("fieldset");
        wrapper.disabled = true;
        page.panel.before(wrapper);
        wrapper.append(page.panel);
        break;
      }
    }
    const before = page.pw.value;
    expect(await run()).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.click).not.toHaveBeenCalled();
    expect(page.pw.value).toBe(before);
  });
  it.each([
    "GET",
    "foreign action",
    "foreign base",
    "signup action",
    "target",
    "formaction",
  ])("rejects unsafe legacy %s", async (kind) => {
    const page = mount(true),
      form = page.panel as HTMLFormElement;
    if (kind === "GET") form.method = "get";
    if (kind === "foreign action")
      form.action = "https://evil.test/checkpoint/lg/login-submit";
    if (kind === "foreign base")
      document.head.insertAdjacentHTML(
        "beforeend",
        '<base href="https://evil.test/">',
      );
    if (kind === "signup action") form.action = "/signup";
    if (kind === "target") form.target = "_blank";
    if (kind === "formaction")
      page.button.setAttribute("formaction", "/checkpoint/lg/login-submit");
    await run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(page.pw.value).toBe("");
  });
  it("does not fill a replacement panel after credential redemption", async () => {
    const page = mount();
    fetchMock.mockImplementation(async () => {
      page.panel.replaceWith(page.panel.cloneNode(true));
      return { ok: true, json: async () => ({ ...credentials(), selectors }) };
    });
    expect(await run()).toMatchObject({ ok: false });
    expect(
      document.querySelector<HTMLInputElement>('input[type="password"]')!.value,
    ).toBe("");
  });
  it.each(["focus", "input"])(
    "preserves manual password edits during username %s",
    async (event) => {
      const page = mount();
      page.user.addEventListener(event, () => {
        page.pw.value = "manual-secret";
      });
      expect(await run()).toMatchObject({ ok: false });
      expect(page.pw.value).toBe("manual-secret");
      expect(page.click).not.toHaveBeenCalled();
    },
  );
  it.each([
    "cancel",
    "timeout",
    "manual edit",
    "origin changed",
    "target changed",
  ])("stops waiting on %s", async (kind) => {
    const page = mount(true, false);
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(200);
    expect(page.pw.value).toBe(credentials().password);
    if (kind === "cancel") client.cancel();
    if (kind === "manual edit") page.pw.value = "manual-secret";
    if (kind === "origin changed")
      Reflect.deleteProperty(window, "__sorng_map_navigation");
    if (kind === "target changed")
      (page.panel as HTMLFormElement).target = "_blank";
    await vi.advanceTimersByTimeAsync(10000);
    expect(await pending).toMatchObject({ ok: false });
    expect(page.pw.value).toBe(kind === "manual edit" ? "manual-secret" : "");
    page.button.disabled = false;
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.click).not.toHaveBeenCalled();
  });
  it("does not retry after an error and refuses synchronous fallback", async () => {
    const page = mount();
    expect(client.attempt(credentials(), selectors)).toMatchObject({
      ok: false,
      reason: "form-readiness-required",
    });
    page.button.addEventListener("click", () =>
      page.panel.insertAdjacentHTML(
        "beforeend",
        '<div role="alert">Rejected</div>',
      ),
    );
    await run();
    await vi.advanceTimersByTimeAsync(60000);
    expect(page.click).toHaveBeenCalledOnce();
  });
});
