import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const googleSource = readFileSync(
  "src-tauri/crates/sorng-protocols/src/google_autologin_client.js",
  "utf8",
);
const autologinSource = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);

type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors: undefined,
    loginFlow: "google" | "google-password",
  ): void;
  cancel(): void;
};

let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;

function makeVisible(element: Element) {
  Object.defineProperty(element, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
  vi.spyOn(element, "getClientRects").mockReturnValue([
    { width: 30, height: 20 },
  ] as unknown as DOMRectList);
}

function install(path: string, html: string) {
  history.replaceState({}, "", path);
  document.body.innerHTML = html;
  for (const element of document.querySelectorAll("input,button"))
    makeVisible(element);
  Reflect.deleteProperty(window, "__sorng_google_login");
  Reflect.deleteProperty(window, "__sorng_autologin");
  window.eval(`${googleSource}\n${autologinSource}`);
  client = (
    window as unknown as {
      __sorng_autologin: Client;
    }
  ).__sorng_autologin;
}

function mountPassword() {
  const panel = document.createElement("div");
  panel.id = "password-panel";
  panel.innerHTML =
    '<input name="Passwd" type="password"><div id="passwordNext"><button type="button">Next</button></div>';
  document.body.appendChild(panel);
  const field = panel.querySelector<HTMLInputElement>("input")!;
  const button = panel.querySelector<HTMLButtonElement>("button")!;
  makeVisible(field);
  makeVisible(button);
  return { panel, field, click: vi.spyOn(button, "click") };
}

describe("reviewed Google staged auto-login client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    client?.cancel();
    window.dispatchEvent(new Event("pagehide"));
    Reflect.deleteProperty(window, "__sorng_google_login");
    Reflect.deleteProperty(window, "__sorng_autologin");
    Reflect.deleteProperty(window, "__autologin_last");
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("releases only the identifier on the exact identifier page", async () => {
    install(
      "/v3/signin/identifier",
      '<input id="identifierId" name="identifier" type="email"><div id="identifierNext"><button type="button">Next</button></div>',
    );
    const reply = {
      loginFlow: "google",
      username: "person@example.test",
      continuation: "a".repeat(32),
    };
    fetchMock.mockResolvedValue({ ok: true, json: async () => reply });
    const button = document.querySelector<HTMLButtonElement>(
      "#identifierNext button",
    )!;
    const click = vi.spyOn(button, "click");
    client.fetchCredsAndRun("b".repeat(32), undefined, "google");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledWith(
      `/__sortofremoteng_autologin?nonce=${"b".repeat(32)}`,
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
      }),
    );
    expect(
      document.querySelector<HTMLInputElement>("#identifierId")!.value,
    ).toBe("person@example.test");
    expect(click).toHaveBeenCalledOnce();
    expect(reply).toEqual({
      loginFlow: "google",
      username: null,
      continuation: null,
    });
  });

  it("releases only the password on the exact password continuation page", async () => {
    install(
      "/v3/signin/challenge/pwd",
      '<input name="Passwd" type="password"><div id="passwordNext"><button type="button">Next</button></div>',
    );
    const reply = { loginFlow: "google", password: "fixture-secret" };
    fetchMock.mockResolvedValue({ ok: true, json: async () => reply });
    const button = document.querySelector<HTMLButtonElement>(
      "#passwordNext button",
    )!;
    const click = vi.spyOn(button, "click");
    client.fetchCredsAndRun("c".repeat(32), undefined, "google-password");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledWith(
      `/__sortofremoteng_autologin?phase=password&nonce=${"c".repeat(32)}`,
      expect.objectContaining({
        credentials: "same-origin",
        redirect: "error",
      }),
    );
    expect(
      document.querySelector<HTMLInputElement>('input[name="Passwd"]')!.value,
    ).toBe("fixture-secret");
    expect(click).toHaveBeenCalledOnce();
    expect(reply.password).toBeNull();
  });

  it.each(["stable", "replaced", "render gap"])(
    "follows async email-to-password DOM replacement (%s), once per phase",
    async (render) => {
      install(
        "/v3/signin/identifier",
        '<input id="identifierId" name="identifier" type="email"><div id="identifierNext"><button type="button">Next</button></div>',
      );
      const identifier =
        document.querySelector<HTMLInputElement>("#identifierId")!;
      const next = document.querySelector<HTMLButtonElement>(
        "#identifierNext button",
      )!;
      const emailClick = vi.spyOn(next, "click");
      const emailReply = {
        loginFlow: "google",
        username: "person@example.test",
        continuation: "a".repeat(32),
      };
      const passwordReply = { loginFlow: "google", password: "fixture-secret" };
      let resolvePassword!: (reply: typeof passwordReply) => void;
      const passwordBody = new Promise<typeof passwordReply>((resolve) => {
        resolvePassword = resolve;
      });
      fetchMock
        .mockResolvedValueOnce({ ok: true, json: async () => emailReply })
        .mockResolvedValueOnce({ ok: true, json: () => passwordBody });

      let initial!: ReturnType<typeof mountPassword>;
      next.addEventListener("click", () => {
        setTimeout(() => {
          // A SPA retains the filled identifier but replaces its active panel.
          identifier.style.display = "none";
          next.parentElement!.remove();
          initial = mountPassword();
          history.replaceState({}, "", "/v3/signin/challenge/pwd");
        }, 50);
      });
      client.fetchCredsAndRun("b".repeat(32), undefined, "google");
      await vi.advanceTimersByTimeAsync(0);
      expect(identifier.value).toBe("person@example.test");
      expect(emailClick).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(50);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(initial.field.value).toBe("");
      // Re-injection and bootstrap must preserve the running continuation.
      window.eval(`${googleSource}\n${autologinSource}`);
      client.fetchCredsAndRun("a".repeat(32), undefined, "google-password");
      let current = initial;
      if (render !== "stable") initial.panel.remove();
      if (render === "replaced") current = mountPassword();
      resolvePassword(passwordReply);
      await vi.advanceTimersByTimeAsync(0);
      if (render === "render gap") {
        expect(initial.click).not.toHaveBeenCalled();
        current = mountPassword();
        await vi.advanceTimersByTimeAsync(0);
      }

      expect(current.field.value).toBe("fixture-secret");
      expect(current.click).toHaveBeenCalledOnce();
      if (current !== initial) {
        expect(initial.field.value).toBe("");
        expect(initial.click).not.toHaveBeenCalled();
      }
      expect(identifier.value).toBe("person@example.test");
      expect(emailClick).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        `/__sortofremoteng_autologin?nonce=${"b".repeat(32)}`,
        `/__sortofremoteng_autologin?phase=password&nonce=${"a".repeat(32)}`,
      ]);
      expect(emailReply).toEqual({
        loginFlow: "google",
        username: null,
        continuation: null,
      });
      expect(passwordReply.password).toBeNull();
      expect(Reflect.get(window, "__autologin_last")).toEqual({
        ok: true,
        reason: "submitted",
      });
      document.body.appendChild(document.createElement("div"));
      await vi.advanceTimersByTimeAsync(1000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(current.click).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "cancelled",
    "expired render gap",
    "CAPTCHA",
    "MFA",
    "external handoff",
    "ambiguous password",
    "prefilled password",
    "button replaced during fill",
  ])(
    "does not submit after %s while the password grant is pending",
    async (change) => {
      install("/v3/signin/challenge/pwd", "");
      const target = mountPassword();
      const reply = { loginFlow: "google", password: "fixture-secret" };
      let resolvePassword!: (value: typeof reply) => void;
      fetchMock.mockResolvedValue({
        ok: true,
        json: () =>
          new Promise<typeof reply>((resolve) => {
            resolvePassword = resolve;
          }),
      });
      client.fetchCredsAndRun("c".repeat(32), undefined, "google-password");
      await vi.advanceTimersByTimeAsync(0);
      const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
      if (change === "cancelled") window.dispatchEvent(new Event("pagehide"));
      if (change === "expired render gap") target.panel.remove();
      if (change === "CAPTCHA") {
        const captcha = document.createElement("input");
        captcha.name = "captcha";
        document.body.appendChild(captcha);
        makeVisible(captcha);
      }
      if (change === "MFA")
        history.replaceState({}, "", "/v3/signin/challenge/totp");
      if (change === "external handoff")
        history.replaceState({}, "", "/external-login");
      if (change === "ambiguous password") mountPassword();
      if (change === "prefilled password") target.field.value = "manual-entry";
      if (change === "button replaced during fill") {
        target.field.addEventListener("input", () => {
          const button = target.panel.querySelector("button")!;
          const replacement = button.cloneNode(true);
          button.replaceWith(replacement);
          makeVisible(replacement as Element);
        });
      }
      // Even a body promise that completes after abort must not resume filling.
      resolvePassword(reply);
      await vi.advanceTimersByTimeAsync(30_000);
      if (change === "expired render gap") {
        document.body.appendChild(target.panel);
        await vi.advanceTimersByTimeAsync(250);
      }
      expect(target.click).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(reply.password).toBeNull();
      expect(signal.aborted).toBe(true);
      expect(Reflect.get(window, "__autologin_last")).toMatchObject({
        ok: false,
      });
      if (change !== "button replaced during fill") {
        expect(target.field.value).toBe(
          change === "prefilled password" ? "manual-entry" : "",
        );
      }
    },
  );

  it("does not retry a rejected password grant", async () => {
    install("/v3/signin/challenge/pwd", "");
    const target = mountPassword();
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    client.fetchCredsAndRun("c".repeat(32), undefined, "google-password");
    await vi.advanceTimersByTimeAsync(1000);
    target.panel.remove();
    const replacement = mountPassword();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(target.field.value).toBe("");
    expect(replacement.field.value).toBe("");
    expect(target.click).not.toHaveBeenCalled();
    expect(replacement.click).not.toHaveBeenCalled();
    expect(Reflect.get(window, "__autologin_last")).toEqual({
      ok: false,
      reason: "reviewed-login-stopped",
    });
  });

  it("does not request credentials on an unknown or CAPTCHA challenge", async () => {
    install(
      "/v3/signin/challenge/recaptcha",
      '<input id="identifierId" name="identifier" type="email"><input name="captcha"><div id="identifierNext"><button type="button">Next</button></div>',
    );
    client.fetchCredsAndRun("d".repeat(32), undefined, "google");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLInputElement>("#identifierId")!.value,
    ).toBe("");
  });
});
