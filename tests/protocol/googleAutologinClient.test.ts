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
