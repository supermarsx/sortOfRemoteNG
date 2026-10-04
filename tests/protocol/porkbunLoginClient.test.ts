import { loadAutologinClient } from "../helpers/autologinAsset";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PORKBUN_LOGIN_SELECTORS,
  PORKBUN_TOTP_CHALLENGE,
} from "../../src/utils/connection/porkbunProfile";
import { DEFAULT_HTTP_FORM_AUTOMATION } from "../../src/utils/connection/httpFormAutomation";
import { porkbunLoginHtml } from "./fixtures/porkbunLogin";

const source = loadAutologinClient();
const routingSource = readFileSync(
  "src-tauri/crates/sorng-protocols/src/web_network_client.js",
  "utf8",
);
const proxyOrigin = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
let routing: { dispose(): void } | undefined;
function installRouting() {
  vi.stubGlobal("location", new URL(`${proxyOrigin}/account/login`));
  vi.spyOn(document, "baseURI", "get").mockReturnValue(
    `${proxyOrigin}/account/login`,
  );
  const install = window.eval(
    `(function(){${routingSource}\nreturn installWebNetworkClient;})()`,
  );
  routing = install(
    {
      version: 1,
      sessionId: "synthetic-porkbun-session",
      documentSequence: 1,
      sourceOrigin: "https://porkbun.com",
      proxyOrigin,
      mappings: [],
    },
    vi.fn(),
  );
}
const selectors = {
  username: PORKBUN_LOGIN_SELECTORS.usernameSelector,
  password: PORKBUN_LOGIN_SELECTORS.passwordSelector,
  submit: PORKBUN_LOGIN_SELECTORS.submitSelector,
};
type Credentials = { username: string | null; password: string | null };
type Result = { ok: boolean; reason: string; via?: string };
type Client = {
  bootstrap(
    credentials: Credentials,
    selectors: object,
    options?: unknown,
  ): Promise<Result>;
  fetchCredsAndRun(nonce: string, selectors: object): Promise<Result>;
  cancel(): void;
};
let client: Client;
let login: ReturnType<typeof vi.fn<() => void>>;
let fetchCredentials: ReturnType<typeof vi.fn>;
let nativeSubmit: ReturnType<typeof vi.spyOn>;
let requestSubmit: ReturnType<typeof vi.spyOn>;
const originalUrl = location.href;
const field = (id: string) => document.getElementById(id) as HTMLInputElement;
const button = () =>
  document.getElementById("accountLoginButton") as HTMLButtonElement;
const form = () => document.getElementById("loginForm") as HTMLFormElement;
const credentials = (): Credentials => ({
  username: "fixture-user",
  password: "fixture-password",
});
const run = (options?: unknown) =>
  client.bootstrap(credentials(), selectors, options);
const siteWindow = () =>
  window as unknown as { logIn: () => void; logInExec: () => void };

beforeEach(() => {
  vi.useFakeTimers();
  history.replaceState({}, "", "/account/login");
  document.body.innerHTML = porkbunLoginHtml;
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(
    function (this: HTMLElement) {
      if (this.hidden || this.style.display === "none") return null;
      for (
        let element: HTMLElement | null = this.parentElement;
        element;
        element = element.parentElement
      ) {
        if (element.hidden || element.style.display === "none") return null;
      }
      return document.body;
    },
  );
  login = vi.fn<() => void>();
  siteWindow().logIn = login;
  siteWindow().logInExec = () => siteWindow().logIn();
  // Preserve the actual onclick attribute; model its native compiled handler.
  button().onclick = () => siteWindow().logInExec();
  fetchCredentials = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => credentials() });
  vi.stubGlobal("fetch", fetchCredentials);
  nativeSubmit = vi
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
  routing?.dispose();
  routing = undefined;
  client.cancel();
  window.removeEventListener("pagehide", client.cancel);
  window.removeEventListener("unload", client.cancel);
  for (const key of [
    "__sorng_autologin",
    "__autologin_last",
    "logIn",
    "logInExec",
  ])
    Reflect.deleteProperty(window, key);
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  history.replaceState({}, "", originalUrl);
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("production password client with public Porkbun DOM (no live account)", () => {
  it.each(["property", "attribute"])(
    "recognizes the reviewed dummy action after the production %s URL setter rewrites it",
    async (setter) => {
      installRouting();
      if (setter === "property") form().action = "/blank";
      else form().setAttribute("action", "/blank");
      expect(form().getAttribute("action")).toBe(`${proxyOrigin}/blank`);
      const pending = client.fetchCredsAndRun("synthetic-nonce", selectors);
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchCredentials).not.toHaveBeenCalled();
      button().disabled = false; // Only the website's own challenge callback enables it.
      await vi.advanceTimersByTimeAsync(61000);
      expect(await pending).toMatchObject({
        ok: true,
        reason: "submitted",
        via: "porkbun-button-click",
      });
      expect(fetchCredentials).toHaveBeenCalledOnce();
      expect(login).toHaveBeenCalledOnce();
      expect(field("loginUsername").value).toBe("fixture-user");
      expect(field("loginPassword").value).toBe("fixture-password");
      expect(nativeSubmit).not.toHaveBeenCalled();
      expect(requestSubmit).not.toHaveBeenCalled();
      expect(form().getAttribute("action")).toBe(`${proxyOrigin}/blank`);
      expect(form().target).toBe("lame_login_iframe");
      expect(field("porkcaptcha-token_accountLogin").value).toBe(
        "fixture-site-managed",
      );
      await client.fetchCredsAndRun("another-synthetic-nonce", selectors);
      expect(fetchCredentials).toHaveBeenCalledOnce();
      expect(login).toHaveBeenCalledOnce();
    },
  );

  it.each([
    "https://porkbun.com/blank",
    "http://p1123456789abcdef0123456789abcdef.localhost:43123/blank",
    "http://p0123456789abcdef0123456789abcdef.localhost:43124/blank",
    "https://foreign.example.test/blank",
    "/blank?next=synthetic",
    "/blank#fragment",
    "/blank/",
    "/other/../blank",
    "/%62lank",
    "//foreign.example.test/blank",
    "",
  ])("does not broaden the reviewed action to %s", async (action) => {
    installRouting();
    // Model parser-supplied markup directly, without repairing the hostile
    // literal through the network setter before the adapter can inspect it.
    form().getAttributeNode("action")!.value = action;
    button().disabled = false;
    const pending = client.fetchCredsAndRun("synthetic-nonce", selectors);
    await vi.advanceTimersByTimeAsync(61000);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-not-found-timeout",
    });
    expect(fetchCredentials).not.toHaveBeenCalled();
    expect(field("loginUsername").value).toBe("");
    expect(field("loginPassword").value).toBe("");
    expect(login).not.toHaveBeenCalled();
  });

  it("rejects a foreign base even when the rewritten action names the local session", async () => {
    installRouting();
    form().action = "/blank";
    vi.spyOn(document, "baseURI", "get").mockReturnValue(
      "https://foreign.example.test/",
    );
    button().disabled = false;
    const pending = client.fetchCredsAndRun("synthetic-nonce", selectors);
    await vi.advanceTimersByTimeAsync(61000);
    expect(await pending).toMatchObject({ ok: false });
    expect(fetchCredentials).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("retains the raw action fingerprint across the fill delay", async () => {
    installRouting();
    button().disabled = false;
    const pending = run({ ...DEFAULT_HTTP_FORM_AUTOMATION, fillDelayMs: 500 });
    expect(field("loginUsername").value).toBe("");
    form().action = "/blank"; // Semantically equivalent, but not the captured raw action.
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-changed-or-unsafe",
    });
    expect(field("loginPassword").value).toBe("");
    expect(login).not.toHaveBeenCalled();
  });

  it("revalidates a rewritten action when delayed credentials arrive and never retries redemption", async () => {
    installRouting();
    form().action = "/blank";
    button().disabled = false;
    let release!: (value: {
      ok: boolean;
      json: () => Promise<Credentials>;
    }) => void;
    fetchCredentials.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = client.fetchCredsAndRun("synthetic-nonce", selectors);
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchCredentials).toHaveBeenCalledOnce();
    form().getAttributeNode("action")!.value =
      "https://foreign.example.test/blank";
    release({ ok: true, json: async () => credentials() });
    await vi.advanceTimersByTimeAsync(61000);
    expect(await pending).toMatchObject({ ok: false });
    expect(field("loginUsername").value).toBe("");
    expect(field("loginPassword").value).toBe("");
    expect(login).not.toHaveBeenCalled();
    expect(fetchCredentials).toHaveBeenCalledOnce();
  });

  it("does not redeem on a proxied MFA stage or bypass the site's initialization visibility", async () => {
    installRouting();
    form().action = "/blank";
    button().disabled = false;
    button().parentElement!.style.display = "none";
    const pending = client.fetchCredsAndRun("synthetic-nonce", selectors);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchCredentials).not.toHaveBeenCalled();
    document.getElementById("twoFactorLoginContainer")!.style.display = "block";
    button().parentElement!.style.display = "block";
    await vi.advanceTimersByTimeAsync(61000);
    expect(await pending).toMatchObject({ ok: false });
    expect(fetchCredentials).not.toHaveBeenCalled();
    expect(field("twoFactorLoginCode").value).toBe("");
    expect(login).not.toHaveBeenCalled();
  });

  it("waits for the site's challenge and handler, then redeems once and clicks Login once", async () => {
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(45000);
    expect(fetchCredentials).not.toHaveBeenCalled();
    expect(field("loginPassword").value).toBe("");
    expect(login).not.toHaveBeenCalled();
    button().disabled = false; // Model the website's own CAPTCHA callback.
    await vi.advanceTimersByTimeAsync(300);
    expect(await pending).toMatchObject({
      ok: true,
      reason: "submitted",
      via: "porkbun-button-click",
    });
    expect(fetchCredentials).toHaveBeenCalledOnce();
    expect(fetchCredentials).toHaveBeenCalledWith(
      expect.stringContaining("/__sortofremoteng_autologin?nonce="),
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
    expect(field("loginUsername").value).toBe("fixture-user");
    expect(field("loginPassword").value).toBe("fixture-password");
    expect(login).toHaveBeenCalledOnce();
    expect(nativeSubmit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(form().target).toBe("lame_login_iframe");
    expect(form().getAttribute("action")).toBe("/blank");
    expect(form().getAttribute("data-pbrf")).toBe("fixture-site-managed");
    expect(field("porkcaptcha-token_accountLogin").value).toBe(
      "fixture-site-managed",
    );
    expect(field("rememberMe").checked).toBe(false);
    for (const input of document.querySelectorAll<HTMLInputElement>(
      'input[autocomplete="one-time-code"], #bypassTwoFactor2FACode',
    ))
      expect(input.value).toBe("");
    await client.fetchCredsAndRun("another-nonce", selectors);
    await vi.advanceTimersByTimeAsync(10000);
    expect(login).toHaveBeenCalledOnce();
    expect(fetchCredentials).toHaveBeenCalledOnce();
  });

  it("expires a disabled challenge without redeeming credentials or changing CAPTCHA", async () => {
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(59999);
    expect(fetchCredentials).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-not-found-timeout",
    });
    expect(fetchCredentials).not.toHaveBeenCalled();
    expect(button().disabled).toBe(true);
    expect(field("loginUsername").value).toBe("");
    expect(field("loginPassword").value).toBe("");
  });

  it("cancels a pending challenge on pagehide", async () => {
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    window.dispatchEvent(new Event("pagehide"));
    button().disabled = false;
    await vi.advanceTimersByTimeAsync(9000);
    expect(await pending).toMatchObject({ ok: false, reason: "cancelled" });
    expect(fetchCredentials).not.toHaveBeenCalled();
  });

  it("supports fill-only and drops the credential object without invoking the website handler", async () => {
    button().disabled = false;
    const secret = credentials();
    expect(
      await client.bootstrap(secret, selectors, {
        ...DEFAULT_HTTP_FORM_AUTOMATION,
        submit: false,
      }),
    ).toMatchObject({ ok: true, reason: "filled-only" });
    expect(secret).toEqual({ username: null, password: null });
    expect(field("loginPassword").value).toBe("fixture-password");
    expect(login).not.toHaveBeenCalled();
    expect(nativeSubmit).not.toHaveBeenCalled();
  });

  it.each([
    "twoFactorLoginContainer",
    "twoFactorLoginContainerEmail",
    "twoFactorLoginContainerEmailNoCookie",
    "modal_forceCcaptcha",
    "accountLoginErrorAlert",
    "bypassTwoFactor2FACodeContainer",
  ])("does not replay the password on visible %s", async (id) => {
    button().disabled = false;
    document.getElementById(id)!.style.display = "block";
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(61000);
    expect(await pending).toMatchObject({ ok: false });
    expect(fetchCredentials).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });

  it("leaves the post-password app-code stage to the separate MFA engine", async () => {
    button().disabled = false;
    login.mockImplementation(() => {
      document.getElementById("twoFactorLoginContainer")!.style.display =
        "block";
      button().textContent = "Continue";
    });
    expect(await run()).toMatchObject({ ok: true, reason: "submitted" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(login).toHaveBeenCalledOnce();
    expect(field("twoFactorLoginCode").value).toBe("");
    expect(
      document.querySelectorAll(PORKBUN_TOTP_CHALLENGE.codeSelector),
    ).toHaveLength(1);
    expect(document.querySelector(PORKBUN_TOTP_CHALLENGE.codeSelector)).toBe(
      field("twoFactorLoginCode"),
    );
  });

  it.each([
    "action",
    "method",
    "target",
    "formaction",
    "formmethod",
    "formtarget",
    "form",
    "handler",
    "foreign-button",
    "duplicate-button",
    "path",
  ])("refuses a mismatched %s before credential redemption", async (change) => {
    button().disabled = false;
    if (change === "action")
      form().action = "https://foreign.example.test/steal";
    else if (change === "method") form().method = "GET";
    else if (change === "target") form().target = "_top";
    else if (
      ["formaction", "formmethod", "formtarget", "form"].includes(change)
    )
      button().setAttribute(change, "other");
    else if (change === "handler") Reflect.deleteProperty(window, "logInExec");
    else if (change === "foreign-button") document.body.append(button());
    else if (change === "duplicate-button")
      button().parentElement!.append(button().cloneNode(true));
    else if (change === "path") history.replaceState({}, "", "/account/create");
    const pending = client.fetchCredsAndRun("fixture-nonce", selectors);
    await vi.advanceTimersByTimeAsync(61000);
    expect(await pending).toMatchObject({ ok: false });
    expect(fetchCredentials).not.toHaveBeenCalled();
    expect(field("loginPassword").value).toBe("");
    expect(login).not.toHaveBeenCalled();
  });

  it.each([
    "target",
    "method",
    "action",
    "disabled",
    "handler",
    "replacement",
    "challenge",
  ])(
    "rechecks %s after username input before writing the password",
    async (change) => {
      button().disabled = false;
      field("loginUsername").addEventListener("input", () => {
        if (change === "target") form().target = "_top";
        else if (change === "method") form().method = "GET";
        else if (change === "action")
          form().action = "https://foreign.example.test/steal";
        else if (change === "disabled") button().disabled = true;
        else if (change === "handler") siteWindow().logIn = vi.fn();
        else if (change === "replacement")
          button().replaceWith(button().cloneNode(true));
        else
          document.getElementById(
            "twoFactorLoginContainerEmail",
          )!.style.display = "block";
      });
      expect(await run()).toMatchObject({
        ok: false,
        reason: "form-changed-or-unsafe",
      });
      expect(field("loginPassword").value).toBe("");
      expect(login).not.toHaveBeenCalled();
      expect(nativeSubmit).not.toHaveBeenCalled();
    },
  );

  it("rechecks a foreign action during the submit delay", async () => {
    button().disabled = false;
    const pending = run({
      ...DEFAULT_HTTP_FORM_AUTOMATION,
      submitDelayMs: 500,
    });
    form().action = "https://foreign.example.test/steal";
    await vi.advanceTimersByTimeAsync(600);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-changed-or-unsafe",
    });
    expect(login).not.toHaveBeenCalled();
    expect(nativeSubmit).not.toHaveBeenCalled();
  });

  it("preserves generic cross-form restriction for non-Porkbun selectors", async () => {
    button().disabled = false;
    const pending = client.bootstrap(credentials(), {
      ...selectors,
      username: "#loginUsername",
    });
    await vi.advanceTimersByTimeAsync(9000);
    expect(await pending).toMatchObject({
      ok: false,
      reason: "form-not-found-timeout",
    });
    expect(field("loginUsername").value).toBe("");
    expect(field("loginPassword").value).toBe("");
    expect(login).not.toHaveBeenCalled();
  });
});
