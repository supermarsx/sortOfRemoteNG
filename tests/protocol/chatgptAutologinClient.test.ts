import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";

// Semantic contract fixtures only: no claim of captured hydrated ChatGPT DOM.
const source = loadAutologinClient(process.cwd(), [
  "AI_CHAT_CLIENT_JS",
  "CHATGPT_CLIENT_JS",
]);
const email = "fixture@example.test",
  password = "fixture-secret",
  nonce = "a".repeat(32),
  token = "b".repeat(32);
type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors: undefined,
    flow: string,
  ): Promise<unknown>;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
let upstream: string;
const original = location.href;
function page(stage = "email", identity?: string) {
  history.replaceState(
    {},
    "",
    stage === "email" ? "/log-in" : "/log-in/password",
  );
  document.body.innerHTML = `<form><input type="hidden" name="csrf" value="site-token">
    ${identity === undefined ? "" : `<input type="hidden" name="username" value="${identity}">`}
    <input type="${stage === "email" ? "email" : "password"}" name="${stage === "email" ? "email" : "password"}" autocomplete="${stage === "email" ? "email" : "current-password"}">
    <button type="submit">Continue</button><button type="button">Continue with Google</button></form>`;
  const form = document.querySelector("form")!;
  const field = form.querySelector<HTMLInputElement>(
    stage === "email" ? '[type="email"]' : '[type="password"]',
  )!;
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const click = vi.spyOn(button, "click");
  const social = vi.fn();
  form.querySelector('[type="button"]')!.addEventListener("click", social);
  return { form, field, button, click, social };
}
function reply(url: string) {
  return url.includes("phase=password")
    ? { loginFlow: "chatgpt", username: email, password }
    : { loginFlow: "chatgpt", username: email, continuation: token };
}
function start(flow = "chatgpt") {
  return client.fetchCredsAndRun(nonce, undefined, flow);
}
function result() {
  return Reflect.get(window, "__autologin_last");
}
beforeEach(() => {
  vi.useFakeTimers();
  upstream = "https://auth.openai.com";
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 40, height: 20 },
  ] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(
    document.body,
  );
  Object.defineProperty(window, "__sorng_map_navigation", {
    configurable: true,
    value: (input: string) => {
      const url = new URL(input);
      return url.origin === upstream ? location.origin + url.pathname : input;
    },
  });
  fetchMock = vi.fn().mockImplementation(async (url: string) => ({
    ok: true,
    json: async () => reply(url),
  }));
  vi.stubGlobal("fetch", fetchMock);
  window.eval(source);
  client = Reflect.get(window, "__sorng_autologin");
});
afterEach(() => {
  client.cancel();
  window.removeEventListener("pagehide", client.cancel);
  window.removeEventListener("unload", client.cancel);
  for (const key of [
    "__sorng_autologin",
    "__sorng_chatgpt_login",
    "__sorng_ai_chat_form",
    "__sorng_map_navigation",
    "__autologin_last",
  ])
    Reflect.deleteProperty(window, key);
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  document.querySelectorAll("base").forEach((node) => node.remove());
  history.replaceState({}, "", original);
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ChatGPT staged semantic adapter", () => {
  it("releases only email initially, waits for the exact password stage and submits each once through website handlers", async () => {
    const first = page();
    let second: ReturnType<typeof page>;
    const passwordSubmit = vi.fn();
    first.form.addEventListener("submit", (event) => {
      expect(event.defaultPrevented).toBe(true);
      expect(first.field.value).toBe(email);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      setTimeout(() => {
        second = page("password", email);
        second.form.addEventListener("submit", (event) => {
          expect(event.defaultPrevented).toBe(true);
          expect(second.field.value).toBe(password);
          expect(
            second.form.querySelector<HTMLInputElement>('[name="csrf"]')!.value,
          ).toBe("site-token");
          passwordSubmit();
        });
      }, 400);
    });
    const pending = start();
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.click).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(first.click).toHaveBeenCalledOnce();
    expect(passwordSubmit).toHaveBeenCalledOnce();
    expect(first.social).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `/__sortofremoteng_autologin?nonce=${nonce}`,
      `/__sortofremoteng_autologin?phase=password&nonce=${token}`,
    ]);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
    });
    await start();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result())).not.toContain(password);
  });

  it("accepts a native password-document bootstrap only on the exact password path", async () => {
    const current = page("password");
    const submit = vi.fn((event: Event) =>
      expect(event.defaultPrevented).toBe(true),
    );
    current.form.addEventListener("submit", submit);
    const pending = start("chatgpt-password");
    await vi.advanceTimersByTimeAsync(1200);
    expect(await pending).toMatchObject({ ok: true });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `/__sortofremoteng_autologin?phase=password&nonce=${nonce}`,
    );
    expect(submit).toHaveBeenCalledOnce();
  });

  it("allows the source email entry but never sends a second email grant", async () => {
    const current = page();
    upstream = "https://chatgpt.com";
    history.replaceState({}, "", "/auth/login");
    current.form.addEventListener("submit", () => {
      upstream = "https://auth.openai.com";
      page();
    });
    const pending = start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(
      document.querySelector<HTMLInputElement>('[type="email"]')!.value,
    ).toBe("");
  });

  it.each(["OTP", "identity mismatch", "new password", "prefilled password"])(
    "does not request password at %s stage",
    async (kind) => {
      const first = page();
      first.form.addEventListener("submit", () => {
        const next = page(
          "password",
          kind === "identity mismatch" ? "other@example.test" : email,
        );
        if (kind === "OTP")
          next.form.insertAdjacentHTML(
            "beforeend",
            '<input autocomplete="one-time-code">',
          );
        if (kind === "new password") next.field.autocomplete = "new-password";
        if (kind === "prefilled password") next.field.value = "user-value";
      });
      const pending = start();
      await vi.advanceTimersByTimeAsync(31000);
      await pending;
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(result().ok).toBe(false);
    },
  );

  it.each(["hidden", "readonly"])(
    "checks a fresh password document's %s identity against the native grant",
    async (kind) => {
      const current = page("password", email);
      if (kind === "readonly") {
        const identity =
          current.form.querySelector<HTMLInputElement>('[name="username"]')!;
        identity.type = "email";
        identity.readOnly = true;
      }
      const pending = start("chatgpt-password");
      await vi.advanceTimersByTimeAsync(1200);
      expect(await pending).toMatchObject({ ok: true });
      expect(current.field.value).toBe(password);
      expect(current.click).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it("rejects a native password reply for a different email after a same-document email stage", async () => {
    const first = page();
    let second: ReturnType<typeof page> | undefined;
    first.form.addEventListener("submit", () => {
      second = page("password", email);
    });
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes("phase=password")
          ? { loginFlow: "chatgpt", username: "other@example.test", password }
          : reply(url),
    }));
    const pending = start();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await pending).toMatchObject({ ok: false });
    expect(second!.field.value).toBe("");
    expect(second!.click).not.toHaveBeenCalled();
  });

  it.each(["mismatch", "missing native identity"])(
    "never writes a password with %s on a fresh document",
    async (kind) => {
      const current = page(
        "password",
        kind === "mismatch" ? "other@example.test" : email,
      );
      const input = vi.fn();
      current.field.addEventListener("input", input);
      const response: Record<string, unknown> = {
        loginFlow: "chatgpt",
        password,
      };
      if (kind === "mismatch") response.username = email;
      fetchMock.mockResolvedValue({ ok: true, json: async () => response });
      const pending = start("chatgpt-password");
      await vi.advanceTimersByTimeAsync(1200);
      expect(await pending).toMatchObject({ ok: false });
      expect(current.field.value).toBe("");
      expect(input).not.toHaveBeenCalled();
      expect(current.click).not.toHaveBeenCalled();
      expect(response.password).toBeNull();
      expect(response.username).toBeNull();
    },
  );

  it.each([
    "missing helper",
    "missing adapter",
    "foreign proof",
    "signup",
    "foreign action",
    "GET action",
    "duplicate field",
    "hidden field",
    "extra input",
    "challenge",
    "prefilled email",
  ])("rejects %s before fetching email", async (kind) => {
    const current = page();
    switch (kind) {
      case "missing helper":
        Reflect.deleteProperty(window, "__sorng_ai_chat_form");
        break;
      case "missing adapter":
        Reflect.deleteProperty(window, "__sorng_chatgpt_login");
        break;
      case "foreign proof":
        upstream = "https://evil.test";
        break;
      case "signup":
        history.replaceState({}, "", "/create-account");
        break;
      case "foreign action":
        current.form.action = "https://evil.test/log-in";
        break;
      case "GET action":
        current.form.method = "get";
        break;
      case "duplicate field":
        current.form.insertAdjacentHTML("beforeend", '<input type="email">');
        break;
      case "hidden field":
        current.field.hidden = true;
        break;
      case "extra input":
        current.form.insertAdjacentHTML("beforeend", '<input type="text">');
        break;
      case "challenge":
        current.form.insertAdjacentHTML(
          "beforeend",
          '<div role="alert">Verification needed</div>',
        );
        break;
      case "prefilled email":
        current.field.value = email;
        break;
    }
    const pending = start();
    await vi.advanceTimersByTimeAsync(31000);
    await pending;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(current.click).not.toHaveBeenCalled();
  });

  it.each([
    { loginFlow: "claude", username: email, continuation: token },
    { loginFlow: "chatgpt", username: email, continuation: token, password },
    { loginFlow: "chatgpt", username: email },
  ])(
    "rejects an incompatible email response without filling",
    async (response) => {
      const current = page();
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ ...response }),
      });
      const pending = start();
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
      expect(current.field.value).toBe("");
      expect(current.click).not.toHaveBeenCalled();
    },
  );

  it("waits for a disabled button, then cancels and clears only its owned password", async () => {
    const current = page("password");
    current.button.disabled = true;
    const pending = start("chatgpt-password");
    await vi.advanceTimersByTimeAsync(1200);
    expect(current.field.value).toBe(password);
    expect(current.click).not.toHaveBeenCalled();
    client.cancel();
    expect(await pending).toMatchObject({ reason: "cancelled" });
    expect(current.field.value).toBe("");
    current.button.disabled = false;
    await vi.advanceTimersByTimeAsync(30000);
    expect(current.click).not.toHaveBeenCalled();
  });

  it("preserves user edits and stops instead of overwriting or submitting", async () => {
    const current = page("password");
    current.button.disabled = true;
    const pending = start("chatgpt-password");
    await vi.advanceTimersByTimeAsync(600);
    current.field.value = "user-change";
    current.field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(await pending).toMatchObject({ reason: "cancelled" });
    expect(current.field.value).toBe("user-change");
    expect(current.click).not.toHaveBeenCalled();
  });

  it.each(["Create account", "Continue with Google", "Reset password"])(
    "does not redeem for a %s submit button",
    async (label) => {
      const current = page();
      current.button.textContent = label;
      const pending = start();
      await vi.advanceTimersByTimeAsync(31000);
      await pending;
      expect(fetchMock).not.toHaveBeenCalled();
      expect(current.click).not.toHaveBeenCalled();
    },
  );
});
