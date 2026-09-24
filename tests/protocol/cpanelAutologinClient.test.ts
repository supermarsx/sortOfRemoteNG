import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
const selectors = {
  username_selector: 'form#login_form input#user[name="user"]',
  password_selector: 'form#login_form input#pass[name="pass"][type="password"]',
  submit_selector:
    'form#login_form button#login_submit[name="login"][type="submit"]',
};
type Result = { ok: boolean; reason: string };
type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors: object,
    flow: "cpanel",
  ): Promise<Result | undefined>;
  cancel(): void;
};

let client: Client;
let readyState: DocumentReadyState;
let frames: FrameRequestCallback[];
const createSubmitSpy = () =>
  vi.fn((event: Event) => event.preventDefault());
let submit: ReturnType<typeof createSubmitSpy>;

function installForm(disabled = false) {
  document.body.innerHTML = `<form id="login_form" action="/login/" method="post">
    <input id="user" name="user">
    <input id="pass" name="pass" type="password">
    <button id="login_submit" name="login" type="submit" ${disabled ? "disabled" : ""}>Log in</button>
  </form>`;
  for (const element of document.querySelectorAll("input,button"))
    Object.defineProperty(element, "offsetParent", {
      get: () => document.body,
    });
  submit = createSubmitSpy();
  document
    .querySelector("form")!
    .addEventListener("submit", (event) => submit(event));
}

function runFrame() {
  const callback = frames.shift();
  expect(callback).toBeDefined();
  callback!(performance.now());
}

describe("cPanel auto-login readiness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    readyState = "interactive";
    frames = [];
    Object.defineProperty(document, "readyState", {
      configurable: true,
      get: () => readyState,
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ username: "cp-user", password: "cp-secret" }),
      }),
    );
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
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("waits for complete load and two stable render frames before submitting", async () => {
    installForm();
    const pending = client.fetchCredsAndRun("nonce", selectors, "cpanel");
    await vi.advanceTimersByTimeAsync(400);
    expect(submit).not.toHaveBeenCalled();
    expect((document.querySelector("#pass") as HTMLInputElement).value).toBe(
      "",
    );

    readyState = "complete";
    await vi.advanceTimersByTimeAsync(400);
    expect(frames).toHaveLength(1);
    runFrame();
    expect(submit).not.toHaveBeenCalled();
    runFrame();

    await expect(pending).resolves.toMatchObject({
      ok: true,
      reason: "submitted",
    });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("does not submit until cPanel enables its login control", async () => {
    readyState = "complete";
    installForm(true);
    const pending = client.fetchCredsAndRun("nonce", selectors, "cpanel");
    await vi.advanceTimersByTimeAsync(400);
    expect(frames).toHaveLength(0);
    expect(submit).not.toHaveBeenCalled();

    (document.querySelector("#login_submit") as HTMLButtonElement).disabled =
      false;
    await vi.advanceTimersByTimeAsync(400);
    runFrame();
    runFrame();

    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("restarts readiness when cPanel replaces the form between frames", async () => {
    readyState = "complete";
    installForm();
    const pending = client.fetchCredsAndRun("nonce", selectors, "cpanel");
    await vi.advanceTimersByTimeAsync(0);
    runFrame();
    installForm();
    runFrame();
    expect(submit).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    runFrame();
    runFrame();

    await expect(pending).resolves.toMatchObject({ reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });
});
