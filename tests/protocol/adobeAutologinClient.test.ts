import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/adobe_autologin_client.js",
  "utf8",
);
const coordinator = loadAutologinClient();
const user = "fixture@example.test";
const secret = "synthetic-password";
const nonce = "a".repeat(32);
const token = "b".repeat(32);
const emailHtml = `<form id="EmailForm"><input id="EmailPage-EmailField" name="username" type="email">
  <div hidden><input type="password" name="passwd"></div>
  <button data-id="EmailPage-ContinueButton" type="submit">Continue</button></form>`;
const passwordHtml = `<form id="PasswordForm"><div hidden><input type="email" name="username"
  autocomplete="username" readonly value="${user}"></div>
  <input id="PasswordPage-PasswordField" name="password" type="password" autocomplete="current-password">
  <button data-id="PasswordPage-ContinueButton" type="submit">Continue</button></form>`;
type Client = {
  fetchCredsAndRun(nonce: string, selectors: undefined, flow: string): void;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;

function visible() {
  for (const node of document.querySelectorAll<HTMLElement>(
    "form,input,button,iframe,[role=alert]",
  )) {
    Object.defineProperty(node, "offsetParent", {
      configurable: true,
      get: () => document.body,
    });
    vi.spyOn(node, "getClientRects").mockReturnValue([
      { width: 40, height: 20 },
    ] as unknown as DOMRectList);
  }
}
function mountPassword() {
  history.replaceState({}, "", "/en_US/index.html#/password");
  document.body.innerHTML = passwordHtml;
  visible();
  return document.querySelector<HTMLFormElement>("form")!;
}
function install(
  html = emailHtml,
  path = "/en_US/index.html#/",
  include = true,
) {
  history.replaceState({}, "", path);
  document.body.innerHTML = html;
  visible();
  window.eval((include ? source : "") + "\n" + coordinator);
  client = Reflect.get(window, "__sorng_autologin") as Client;
}
function start() {
  client.fetchCredsAndRun(nonce, undefined, "adobe");
}
function emailReply() {
  return { loginFlow: "adobe", username: user, continuation: token };
}
function passwordReply() {
  return { loginFlow: "adobe", password: secret };
}
function replies() {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve({
      ok: true,
      json: async () =>
        url.includes("phase=password") ? passwordReply() : emailReply(),
    }),
  );
}
async function reachPassword() {
  replies();
  install();
  document.querySelector("form")!.addEventListener(
    "submit",
    (event) => {
      expect(event.defaultPrevented).toBe(true);
      mountPassword();
    },
    { once: true },
  );
  start();
  await vi.advanceTimersByTimeAsync(1300);
}

describe("Adobe reviewed staged login", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    client?.cancel();
    window.dispatchEvent(new Event("pagehide"));
    for (const key of [
      "__sorng_autologin",
      "__sorng_adobe_login",
      "__autologin_last",
    ])
      Reflect.deleteProperty(window, key);
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("releases email only, leaves the hidden passwd decoy untouched and uses a one-shot continuation", async () => {
    replies();
    install();
    const decoy = document.querySelector<HTMLInputElement>('[name="passwd"]')!;
    let submitted = 0;
    document.querySelector("form")!.addEventListener(
      "submit",
      (event) => {
        expect(event.defaultPrevented).toBe(true);
        expect(decoy.value).toBe("");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const form = mountPassword();
        window.dispatchEvent(new HashChangeEvent("hashchange"));
        form.addEventListener("submit", (passwordEvent) => {
          expect(passwordEvent.defaultPrevented).toBe(true);
          expect(
            form.querySelector<HTMLInputElement>('[name="password"]')!.value,
          ).toBe(secret);
          submitted++;
        });
      },
      { once: true },
    );
    start();
    await vi.advanceTimersByTimeAsync(3500);
    expect(submitted).toBe(1);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `/__sortofremoteng_autologin?nonce=${nonce}`,
      `/__sortofremoteng_autologin?phase=password&nonce=${token}`,
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Reflect.get(window, "__autologin_last")).toEqual({
      ok: true,
      reason: "submitted",
    });
    expect(
      JSON.stringify(Reflect.get(window, "__autologin_last")),
    ).not.toContain(secret);
  });

  it("missing Adobe module never redeems via generic login", async () => {
    install(emailHtml, "/en_US/index.html#/", false);
    start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Reflect.get(window, "__autologin_last")).toMatchObject({
      reason: "autologin-client-unavailable",
    });
  });

  it.each([
    "/en_US/other.html#/",
    "/fr_FR/index.html#/",
    "/en_US/index.html#/signup",
    "/en_US/index.html#/identities",
    "/en_US/index.html#/challenge",
    "/en_US/index.html#/federated-wait",
    "/en_US/index.html#/login/code",
    "/en_US/index.html#/welcome-back",
  ])("does not redeem on unreviewed route %s", async (path) => {
    install(emailHtml, path);
    start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "foreign action",
    "GET method",
    "new target",
    "button override",
    "duplicate field",
    "duplicate form",
    "decoy visible",
  ])("rejects %s before redemption", async (change) => {
    install();
    const form = document.querySelector<HTMLFormElement>("form")!;
    if (change === "foreign action")
      form.action = "https://foreign.invalid/steal";
    if (change === "GET method") form.method = "get";
    if (change === "new target") form.target = "other";
    if (change === "button override")
      form.querySelector("button")!.setAttribute("formaction", "");
    if (change === "duplicate field")
      form.append(form.querySelector("input")!.cloneNode(true));
    if (change === "duplicate form") document.body.append(form.cloneNode(true));
    if (change === "decoy visible")
      form.querySelector<HTMLElement>("[hidden]")!.hidden = false;
    start();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "foreign flow",
    "unexpected password",
    "bad token",
    "different existing email",
  ])("rejects %s in email grant", async (change) => {
    install();
    const reply: Record<string, unknown> = emailReply();
    if (change === "foreign flow") reply.loginFlow = "google";
    if (change === "unexpected password") reply.password = secret;
    if (change === "bad token") reply.continuation = "bad";
    if (change === "different existing email")
      document.querySelector<HTMLInputElement>("#EmailPage-EmailField")!.value =
        "other@example.test";
    fetchMock.mockResolvedValue({ ok: true, json: async () => reply });
    const click = vi.spyOn(document.querySelector("button")!, "click");
    start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(click).not.toHaveBeenCalled();
    expect(reply.password).toBeNull();
    expect(reply.username).toBeNull();
    expect(reply.continuation).toBeNull();
  });

  it.each([
    "cancel",
    "pagehide",
    "field edit",
    "button replacement",
    "action change",
    "deadline",
  ])("rechecks pending email response after %s", async (change) => {
    install();
    let resolve!: (reply: ReturnType<typeof emailReply>) => void;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    const field = document.querySelector<HTMLInputElement>(
      "#EmailPage-EmailField",
    )!;
    const button = document.querySelector("button")!;
    const click = vi.spyOn(button, "click");
    start();
    await vi.advanceTimersByTimeAsync(500);
    if (change === "cancel") client.cancel();
    if (change === "pagehide") window.dispatchEvent(new Event("pagehide"));
    if (change === "field edit") field.value = "edited@example.test";
    if (change === "button replacement") {
      button.replaceWith(button.cloneNode(true));
      visible();
    }
    if (change === "action change")
      document.querySelector<HTMLFormElement>("form")!.action =
        "https://foreign.invalid/";
    if (change === "deadline") vi.setSystemTime(Date.now() + 90000);
    const reply = emailReply();
    resolve(reply);
    await vi.advanceTimersByTimeAsync(0);
    expect(click).not.toHaveBeenCalled();
    expect(field.value).not.toBe(user);
    expect(reply.username).toBeNull();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it.each([
    "identity",
    "challenge",
    "MFA",
    "error",
    "recovery",
    "password exists",
  ])("does not redeem password after %s", async (change) => {
    await reachPassword();
    const form = document.querySelector<HTMLFormElement>("#PasswordForm")!;
    if (change === "identity")
      form.querySelector<HTMLInputElement>('[name="username"]')!.value =
        "other@example.test";
    if (change === "challenge")
      form.insertAdjacentHTML(
        "beforeend",
        '<iframe src="https://fixture.invalid/captcha"></iframe>',
      );
    if (change === "MFA")
      form.insertAdjacentHTML(
        "beforeend",
        '<input autocomplete="one-time-code">',
      );
    if (change === "error")
      form.insertAdjacentHTML(
        "beforeend",
        '<div role="alert">Sign in failed</div>',
      );
    if (change === "recovery")
      history.replaceState({}, "", "/en_US/index.html#/password-change");
    if (change === "password exists")
      form.querySelector<HTMLInputElement>('[name="password"]')!.value =
        "user-entered";
    visible();
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never resumes after an account mismatch is later repaired", async () => {
    await reachPassword();
    const identity =
      document.querySelector<HTMLInputElement>('[name="username"]')!;
    identity.value = "changed@example.test";
    await vi.advanceTimersByTimeAsync(100);
    identity.value = user;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(Reflect.get(window, "__autologin_last")).toMatchObject({
      ok: false,
    });
  });

  it.each(["challenge", "identity", "action", "field replacement"])(
    "drops a filled password after %s mutation before submit",
    async (change) => {
      await reachPassword();
      const form = document.querySelector<HTMLFormElement>("#PasswordForm")!;
      const field = form.querySelector<HTMLInputElement>('[name="password"]')!;
      const click = vi.spyOn(form.querySelector("button")!, "click");
      await vi.advanceTimersByTimeAsync(500);
      expect(field.value).toBe(secret);
      if (change === "challenge")
        form.insertAdjacentHTML(
          "beforeend",
          '<input autocomplete="one-time-code">',
        );
      if (change === "identity")
        form.querySelector<HTMLInputElement>('[name="username"]')!.value =
          "changed@example.test";
      if (change === "action") form.action = "https://foreign.invalid/";
      if (change === "field replacement")
        field.replaceWith(field.cloneNode(true));
      visible();
      await vi.advanceTimersByTimeAsync(900);
      expect(field.value).toBe("");
      expect(click).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("rechecks identity after password fetch, clears the reply and never fills", async () => {
    await reachPassword();
    let resolve!: (reply: ReturnType<typeof passwordReply>) => void;
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    await vi.advanceTimersByTimeAsync(500);
    document.querySelector<HTMLInputElement>('[name="username"]')!.value =
      "changed@example.test";
    const reply = passwordReply();
    resolve(reply);
    await vi.advanceTimersByTimeAsync(0);
    expect(reply.password).toBeNull();
    expect(
      document.querySelector<HTMLInputElement>('[name="password"]')!.value,
    ).toBe("");
  });

  it.each(["focus", "input"])(
    "cancels during password %s without retaining the secret",
    async (event) => {
      await reachPassword();
      const field =
        document.querySelector<HTMLInputElement>('[name="password"]')!;
      const click = vi.spyOn(document.querySelector("button")!, "click");
      field.addEventListener(event, () => client.cancel(), { once: true });
      await vi.advanceTimersByTimeAsync(1800);
      expect(field.value).toBe("");
      expect(click).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("allows React to enable a disabled button after input, with no native submission fallback", async () => {
    replies();
    install();
    const button = document.querySelector<HTMLButtonElement>("button")!;
    button.disabled = true;
    const submit = vi.fn((event: Event) =>
      expect(event.defaultPrevented).toBe(true),
    );
    document.querySelector("form")!.addEventListener("submit", submit);
    document.querySelector("input")!.addEventListener("input", () => {
      button.disabled = false;
    });
    start();
    await vi.advanceTimersByTimeAsync(1800);
    expect(submit).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out without credentials when the reviewed form never appears", async () => {
    install("<div>Loading</div>");
    start();
    await vi.advanceTimersByTimeAsync(90000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(Reflect.get(window, "__autologin_last")).toMatchObject({
      reason: "reviewed-login-timeout",
    });
  });
});
