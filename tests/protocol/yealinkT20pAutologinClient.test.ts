import { readFileSync } from "node:fs";
import { loadAutologinClient } from "../helpers/autologinAsset";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markup = readFileSync("tests/fixtures/yealink-t20p.html", "utf8");
const source = ["yealink_autologin_client.js", "autologin_client.js"]
  .map((name) =>
    name === "autologin_client.js"
      ? loadAutologinClient()
      : readFileSync(`src-tauri/crates/sorng-protocols/src/${name}`, "utf8"),
  )
  .join("\n");
type Result = { ok: boolean; reason: string; via?: string };
type Client = {
  fetchCredsAndRun(
    nonce: string,
    selectors: null,
    flow: string,
  ): Promise<Result>;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
let confirm: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let directSubmit: ReturnType<typeof vi.spyOn>;
let requestSubmit: ReturnType<typeof vi.spyOn>;
let response: { username: string | null; password: string | null };
const form = () => document.querySelector("form")!;
const field = (name: string) =>
  form().querySelector<HTMLInputElement>(`[name="${name}"]`)!;
const start = () =>
  client.fetchCredsAndRun("fixture-nonce", null, "yealink-t20p");

function ready() {
  confirm = vi.fn(() => {
    expect(field("username").value).toBe("fixture-admin");
    expect(field("pwd").value).toBe("fixture-password");
    expect(field("jumpto").value).toBe("status");
    expect(field("acc").value).toBe("");
  });
  vi.stubGlobal("OnConfirm", confirm);
  cancel = vi.fn();
  vi.stubGlobal("OnClear", cancel);
  form().onsubmit = () => false;
  (document.querySelector("#idConfirm") as HTMLInputElement).onclick = () => {
    (window as unknown as { OnConfirm(): void }).OnConfirm();
  };
}

describe("keyless Yealink T20P native page handler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = markup;
    for (const element of document.querySelectorAll("input"))
      Object.defineProperty(element, "offsetParent", {
        get: () => document.body,
      });
    response = { username: "fixture-admin", password: "fixture-password" };
    fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal("fetch", fetchMock);
    ready();
    directSubmit = vi
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
      "__sorng_yealink_login",
      "__autologin_last",
    ])
      Reflect.deleteProperty(window, key);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });
  it("fills named controls and clicks OnConfirm once without bypassing page submission", async () => {
    expect(await start()).toEqual({
      ok: true,
      reason: "submitted",
      via: "yealink-OnConfirm-click",
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    expect(directSubmit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "/__sortofremoteng_autologin?nonce=fixture-nonce",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(response).toEqual({ username: null, password: null });
    await start();
    expect(confirm).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("waits for the page handler before redeeming credentials", async () => {
    vi.stubGlobal("OnConfirm", undefined);
    const pending = start();
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(field("pwd").value).toBe("");
    vi.stubGlobal("OnConfirm", confirm);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ ok: true });
    expect(confirm).toHaveBeenCalledOnce();
  });
  it.each([
    () =>
      form().setAttribute(
        "action",
        "https://other.invalid/servlet?p=login&q=login",
      ),
    () => form().setAttribute("action", "/servlet?p=login&q=login&next=other"),
    () => form().setAttribute("method", "get"),
    () => form().setAttribute("target", "_blank"),
    () => form().setAttribute("name", "unknown"),
    () => {
      field("jumpto").value = "other";
    },
    () => {
      field("acc").value = "other";
    },
    () => document.querySelector("#idConfirm")!.setAttribute("type", "submit"),
    () =>
      document
        .querySelector("#idConfirm")!
        .setAttribute("onclick", "formInput.submit()"),
    () => document.querySelector("#idConfirm")!.remove(),
    () => {
      document.querySelector("#loginPhoneModel")!.textContent = "SIP-T21P";
    },
    () => {
      form().append(field("pwd").cloneNode());
    },
    () => vi.stubGlobal("OnConfirm", undefined),
  ])("refuses an incomplete or unsafe form before fetching", async (mutate) => {
    mutate();
    const pending = start();
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(directSubmit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
  });
  it("stops if the form changes during credential redemption", async () => {
    fetchMock.mockImplementation(async () => {
      form().setAttribute("action", "https://other.invalid/");
      return { ok: true, json: async () => response };
    });
    expect(await start()).toMatchObject({ ok: false });
    expect(field("pwd").value).toBe("");
    expect(confirm).not.toHaveBeenCalled();
    expect(response.password).toBeNull();
  });
  it("revalidates between field writes and never falls back after a page mutation", async () => {
    field("username").addEventListener("input", () =>
      form().setAttribute("action", "https://other.invalid/"),
    );
    expect(await start()).toMatchObject({ ok: false });
    expect(field("pwd").value).toBe("");
    expect(confirm).not.toHaveBeenCalled();
    expect(directSubmit).not.toHaveBeenCalled();
  });
  it("does not retry a refused nonce", async () => {
    fetchMock.mockResolvedValue({ ok: false });
    expect(await start()).toMatchObject({ ok: false });
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(confirm).not.toHaveBeenCalled();
  });
  it("cancels readiness when the page unloads", async () => {
    vi.stubGlobal("OnConfirm", undefined);
    const pending = start();
    window.dispatchEvent(new Event("pagehide"));
    expect(await pending).toMatchObject({ reason: "cancelled" });
    vi.stubGlobal("OnConfirm", confirm);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
