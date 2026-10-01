import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadAutologinClient } from "../helpers/autologinAsset";

// Semantic fixture, not a captured Claude hydrated page. No email is sent.
const source = loadAutologinClient(process.cwd(), [
  "AI_CHAT_CLIENT_JS",
  "CLAUDE_CLIENT_JS",
]);
const email = "fixture@example.test";
type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors: undefined,
    flow: string,
  ): Promise<unknown>;
  cancel(): void;
};
let client: Client, fetchMock: ReturnType<typeof vi.fn>;
const original = location.href;
function page() {
  document.body.innerHTML = `<form><input type="email" autocomplete="email"><input type="hidden" name="csrf" value="untouched">
    <button type="submit">Continue with email</button><button type="button">Continue with Google</button></form>`;
  const form = document.querySelector("form")!;
  const field = form.querySelector<HTMLInputElement>('[type="email"]')!;
  const button = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const click = vi.spyOn(button, "click"),
    social = vi.fn();
  form.querySelector('[type="button"]')!.addEventListener("click", social);
  return { form, field, button, click, social };
}
const start = () =>
  client.fetchCredsAndRun("a".repeat(32), undefined, "claude");
beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/login");
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
    { width: 40, height: 20 },
  ] as unknown as DOMRectList);
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockReturnValue(
    document.body,
  );
  Object.defineProperty(window, "__sorng_map_navigation", {
    configurable: true,
    value: (url: string) => url.replace("https://claude.ai", location.origin),
  });
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ loginFlow: "claude", username: email }),
  });
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
    "__sorng_claude_login",
    "__sorng_ai_chat_form",
    "__sorng_map_navigation",
    "__autologin_last",
  ])
    Reflect.deleteProperty(window, key);
  document.body.innerHTML = "";
  document.querySelectorAll("base").forEach((node) => node.remove());
  history.replaceState({}, "", original);
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Claude email-only semantic adapter", () => {
  it.each(["/login", "/login/"])(
    "submits email once at %s without native GET, then requires manual verification",
    async (path) => {
      history.replaceState({}, "", path);
      const current = page();
      const observed: boolean[] = [];
      current.form.addEventListener("submit", (event) => {
        observed.push(event.defaultPrevented);
      });
      const pending = start();
      await vi.advanceTimersByTimeAsync(1200);
      expect(await pending).toEqual({
        ok: false,
        reason: "manual-email-verification-required",
      });
      expect(current.field.value).toBe(email);
      expect(current.click).toHaveBeenCalledOnce();
      expect(observed).toEqual([true]);
      expect(current.social).not.toHaveBeenCalled();
      expect(
        current.form.querySelector<HTMLInputElement>('[name="csrf"]')!.value,
      ).toBe("untouched");
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0][0]).not.toContain("phase=password");
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      });
      await start();
      await vi.advanceTimersByTimeAsync(60000);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(current.click).toHaveBeenCalledOnce();
      const later = new Event("submit", { cancelable: true, bubbles: true });
      expect(current.form.dispatchEvent(later)).toBe(true);
      expect(observed).toEqual([true, false]);
    },
  );

  it("uses native input events and waits for the site's disabled button", async () => {
    const current = page();
    current.button.disabled = true;
    const input = vi.fn();
    current.field.addEventListener("input", input);
    const pending = start();
    await vi.advanceTimersByTimeAsync(1200);
    expect(input).toHaveBeenCalledOnce();
    expect(current.click).not.toHaveBeenCalled();
    current.button.disabled = false;
    await vi.advanceTimersByTimeAsync(200);
    await pending;
    expect(current.click).toHaveBeenCalledOnce();
  });

  it.each(["password", "continuation", "wrong flow", "empty email"])(
    "rejects %s in the email response",
    async (kind) => {
      const current = page();
      const response: Record<string, unknown> = {
        loginFlow: "claude",
        username: email,
      };
      if (kind === "password") response.password = "never-disclose";
      if (kind === "continuation") response.continuation = "b".repeat(32);
      if (kind === "wrong flow") response.loginFlow = "chatgpt";
      if (kind === "empty email") response.username = "";
      fetchMock.mockResolvedValue({ ok: true, json: async () => response });
      const pending = start();
      await vi.advanceTimersByTimeAsync(1000);
      await pending;
      expect(current.field.value).toBe("");
      expect(current.click).not.toHaveBeenCalled();
      expect(response.password).toBeNull();
    },
  );

  it.each([
    "OTP",
    "password",
    "signup",
    "recovery",
    "foreign action",
    "GET",
    "duplicate email",
    "hidden email",
    "extra editable",
    "duplicate button",
    "error",
    "challenge",
    "already filled",
    "no mapping",
    "missing helper",
    "missing adapter",
  ])("refuses %s without redeeming", async (kind) => {
    const current = page();
    switch (kind) {
      case "OTP":
        current.form.insertAdjacentHTML(
          "beforeend",
          '<input autocomplete="one-time-code">',
        );
        break;
      case "password":
        current.form.insertAdjacentHTML("beforeend", '<input type="password">');
        break;
      case "signup":
        history.replaceState({}, "", "/signup");
        break;
      case "recovery":
        history.replaceState({}, "", "/reset-password");
        break;
      case "foreign action":
        current.form.action = "https://evil.test/login";
        break;
      case "GET":
        current.form.method = "get";
        break;
      case "duplicate email":
        current.form.insertAdjacentHTML("beforeend", '<input type="email">');
        break;
      case "hidden email":
        current.field.hidden = true;
        break;
      case "extra editable":
        current.form.insertAdjacentHTML("beforeend", '<input type="checkbox">');
        break;
      case "duplicate button":
        current.form.insertAdjacentHTML(
          "beforeend",
          '<button type="submit" hidden>Hidden</button>',
        );
        break;
      case "error":
        current.form.insertAdjacentHTML(
          "beforeend",
          '<div role="alert">Error</div>',
        );
        break;
      case "challenge":
        current.form.insertAdjacentHTML(
          "beforeend",
          '<iframe src="about:blank"></iframe>',
        );
        break;
      case "already filled":
        current.field.value = email;
        break;
      case "no mapping":
        Reflect.deleteProperty(window, "__sorng_map_navigation");
        break;
      case "missing helper":
        Reflect.deleteProperty(window, "__sorng_ai_chat_form");
        break;
      case "missing adapter":
        Reflect.deleteProperty(window, "__sorng_claude_login");
        break;
    }
    const pending = start();
    await vi.advanceTimersByTimeAsync(31000);
    await pending;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(current.click).not.toHaveBeenCalled();
  });

  it("stops for user edits while waiting to submit and never resends", async () => {
    const current = page();
    current.button.disabled = true;
    const pending = start();
    await vi.advanceTimersByTimeAsync(600);
    current.field.value = "user@example.test";
    current.field.dispatchEvent(new Event("input", { bubbles: true }));
    expect(await pending).toMatchObject({ ok: false, reason: "cancelled" });
    current.button.disabled = false;
    await vi.advanceTimersByTimeAsync(60000);
    expect(current.field.value).toBe("user@example.test");
    expect(current.click).not.toHaveBeenCalled();
  });

  it("rejects a form action changed by the input handler", async () => {
    const current = page();
    current.field.addEventListener("input", () => {
      current.form.action = "https://evil.test/";
    });
    const pending = start();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
    expect(current.click).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it.each([
    "Sign up",
    "Create account",
    "Reset password",
    "Continue with Google",
    "Use passkey",
  ])("never chooses the %s submit action", async (label) => {
    const current = page();
    current.button.textContent = label;
    const pending = start();
    await vi.advanceTimersByTimeAsync(31000);
    await pending;
    expect(fetchMock).not.toHaveBeenCalled();
    expect(current.click).not.toHaveBeenCalled();
  });
});
