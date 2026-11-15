import { loadAutologinClient } from "../helpers/autologinAsset";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = loadAutologinClient();
type Client = {
  bootstrap(
    creds: { username: string | null; password: string | null },
    selectors?: object,
  ): Promise<{ ok: boolean; reason: string }>;
  fetchCredsAndRun(
    nonce: string,
    selectors?: object,
  ): Promise<{ ok: boolean; reason: string } | undefined>;
  cancel(): void;
};
const win = window as unknown as { __sorng_autologin: Client };
const selectors = {
  username_selector: "#user",
  password_selector: "#pass",
  submit_selector: "#submit",
};

function renderForm() {
  document.body.innerHTML = `<form><input id="user" name="username"><input id="pass" type="password"><button id="submit" type="submit">Login</button></form>`;
  for (const element of document.querySelectorAll("input,button")) {
    Object.defineProperty(element, "offsetParent", {
      get: () => document.body,
    });
  }
  const submit = vi.fn((event: Event) => event.preventDefault());
  document.querySelector("form")!.addEventListener("submit", submit);
  return submit;
}

describe("auto-login form wait wakes on DOM changes", () => {
  let client: Client;
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ username: "admin", password: "secret" }),
      }),
    );
    window.eval(source);
    client = win.__sorng_autologin;
  });
  afterEach(() => {
    client.cancel();
    Reflect.deleteProperty(window, "__sorng_autologin");
    Reflect.deleteProperty(window, "__autologin_last");
    Reflect.deleteProperty(document, "readyState");
    document.body.innerHTML = "";
    vi.clearAllTimers();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("selected-form wait redeems well inside the old 200 ms poll interval", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const pending = client.fetchCredsAndRun("n", selectors);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).not.toHaveBeenCalled();
    renderForm();
    await vi.advanceTimersByTimeAsync(60);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
  });

  it("generic form search fills when the form appears, not after a backoff sleep", async () => {
    const pending = client.bootstrap({ username: "admin", password: "secret" });
    // Burn the first polls so the backoff has grown to its 400 ms ceiling.
    await vi.advanceTimersByTimeAsync(3000);
    const submit = renderForm();
    await vi.advanceTimersByTimeAsync(60);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
    expect((document.getElementById("pass") as HTMLInputElement).value).toBe(
      "secret",
    );
  });

  it("DOM-change wakes do not spend the bounded tries or fill twice", async () => {
    const pending = client.bootstrap({ username: "admin", password: "secret" });
    for (let i = 0; i < 40; i++) {
      document.body.appendChild(document.createElement("div"));
      await vi.advanceTimersByTimeAsync(40);
    }
    const submit = renderForm();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ ok: true, reason: "submitted" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("still reports a bounded timeout when no form ever appears", async () => {
    const pending = client.bootstrap({ username: "admin", password: "secret" });
    await vi.advanceTimersByTimeAsync(9000);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-not-found-timeout",
    });
  });
});
