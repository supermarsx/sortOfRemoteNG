import { loadAutologinClient } from "../helpers/autologinAsset";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NPM_AUTO_LOGIN_SELECTORS } from "../../src/components/integrations/nginxProxyMgr/webUiLaunch";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";

const source = loadAutologinClient();
type Result = { ok: boolean; reason: string };
type Client = {
  fetchCredsAndRun(nonce: string, selectors?: object): Promise<Result>;
  cancel(): void;
};
let client: Client;
let fetchMock: ReturnType<typeof vi.fn>;
const credentials = () => ({
  username: "fixture-admin@example.test",
  password: "fixture-password",
});
const selectorPayload = {
  username_selector: NPM_AUTO_LOGIN_SELECTORS.usernameSelector,
  password_selector: NPM_AUTO_LOGIN_SELECTORS.passwordSelector,
  submit_selector: NPM_AUTO_LOGIN_SELECTORS.submitSelector,
};
const variants = [
  {
    name: "legacy Backbone",
    identity: "identity",
    secret: "secret",
    method: 'method="post"',
  },
  { name: "current React", identity: "email", secret: "password", method: "" },
];

// Legacy controls and POST method are from the user's markup and the official
// v2.12.4 frontend/js/login/ui/login.ejs. login.js delegates submit from its
// Marionette view, reads both values, then calls Api.Tokens.login exactly once.
// https://github.com/NginxProxyManager/nginx-proxy-manager/blob/v2.12.4/frontend/js/login/ui/login.js
function mount(variant = variants[0], action = "") {
  document.body.innerHTML = `<div class="page-single"><form class="card" action="${action}" ${variant.method}>
    <div class="col-sm-12 col-md-6">
      <div class="card-title">Login to your account</div>
      <div class="form-group"><label class="form-label">Email address</label>
        <input name="${variant.identity}" type="email" class="form-control" placeholder="Email address" required autofocus>
      </div>
      <div class="form-group"><label class="form-label">Password</label>
        <input name="${variant.secret}" type="password" class="form-control" placeholder="Password" required>
        <div class="invalid-feedback secret-error"></div>
      </div>
      <div class="form-footer"><button type="submit" class="btn btn-teal btn-block">Sign in</button></div>
    </div>
  </form></div>`;
  for (const element of document.querySelectorAll("input,button"))
    Object.defineProperty(element, "offsetParent", {
      get: () => document.body,
    });
  const read = (name: string) =>
    (document.querySelector(`input[name="${name}"]`) as HTMLInputElement).value;
  const tokenLogin = vi.fn();
  document
    .querySelector(".page-single")!
    .addEventListener("submit", (event) => {
      event.preventDefault();
      (document.querySelector("button") as HTMLButtonElement).disabled = true;
      tokenLogin({
        identity: read(variant.identity),
        secret: read(variant.secret),
      });
    });
  return { tokenLogin, read };
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "readyState", {
    configurable: true,
    value: "complete",
  });
  fetchMock = vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({ ...credentials(), selectors: selectorPayload }),
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
  Reflect.deleteProperty(window, "__sorng_autologin");
  Reflect.deleteProperty(window, "__autologin_last");
  Reflect.deleteProperty(document, "readyState");
  document.body.innerHTML = "";
  vi.clearAllTimers();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Nginx Proxy Manager real auto-login client", () => {
  it.each(variants)(
    "fills and submits the $name form via its own handler once",
    async (variant) => {
      const { tokenLogin, read } = mount(variant);
      expect(
        await client.fetchCredsAndRun("fixture-nonce", selectorPayload),
      ).toMatchObject({
        ok: true,
        reason: "submitted",
      });
      expect(tokenLogin).toHaveBeenCalledExactlyOnceWith({
        identity: credentials().username,
        secret: credentials().password,
      });
      expect(read(variant.identity)).toBe(credentials().username);
      expect(read(variant.secret)).toBe(credentials().password);
      await client.fetchCredsAndRun("another-nonce");
      await vi.advanceTimersByTimeAsync(10000);
      expect(tokenLogin).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        "/__sortofremoteng_autologin?nonce=fixture-nonce",
        expect.objectContaining({
          credentials: "same-origin",
          cache: "no-store",
        }),
      );
    },
  );

  it("waits for the legacy view to mount instead of spending a submission on an empty page", async () => {
    const pending = client.fetchCredsAndRun("fixture-nonce", selectorPayload);
    await vi.advanceTimersByTimeAsync(1200);
    expect(fetchMock).not.toHaveBeenCalled();
    const { tokenLogin } = mount();
    await vi.advanceTimersByTimeAsync(500);
    expect(await pending).toMatchObject({ reason: "submitted" });
    expect(tokenLogin).toHaveBeenCalledOnce();
  });

  it("does not consume the one-use grant on the dashboard shell before its /login redirect", async () => {
    // NPM <= 2.12 starts at /, checks its token asynchronously, then performs
    // window.location = '/login' (app/main.js -> Controller.showLogin).
    const pending = client.fetchCredsAndRun("root-nonce", selectorPayload);
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("pagehide"));
    expect(await pending).toMatchObject({ reason: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();

    window.removeEventListener("pagehide", client.cancel);
    window.removeEventListener("unload", client.cancel);
    Reflect.deleteProperty(window, "__sorng_autologin");
    window.eval(source);
    client = (window as unknown as { __sorng_autologin: Client })
      .__sorng_autologin;
    const { tokenLogin } = mount();
    expect(
      await client.fetchCredsAndRun("login-nonce", selectorPayload),
    ).toMatchObject({
      reason: "submitted",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(tokenLogin).toHaveBeenCalledExactlyOnceWith({
      identity: credentials().username,
      secret: credentials().password,
    });
  });

  it("keeps an external form action fail-closed before filling either legacy field", async () => {
    const { tokenLogin, read } = mount(
      variants[0],
      "https://unapproved.example/collect",
    );
    expect(
      await client.fetchCredsAndRun("fixture-nonce", selectorPayload),
    ).toMatchObject({
      ok: false,
      reason: "unsafe-form-action",
    });
    expect(tokenLogin).not.toHaveBeenCalled();
    expect(read("identity")).toBe("");
    expect(read("secret")).toBe("");
  });

  it("uses both field generations for local and vault credentials without enabling HTTP Basic", () => {
    const connection = {
      ...credentials(),
      httpApplication: {
        version: 1 as const,
        id: "nginxProxyMgr",
        loginMode: "form" as const,
      },
    };
    expect(resolveHttpApplicationLogin(connection)).toEqual({
      credentials: credentials(),
      autoLogin: true,
      upstreamAuthMode: "none",
      selectors: NPM_AUTO_LOGIN_SELECTORS,
    });
    expect(
      resolveHttpApplicationLogin(
        {
          ...connection,
          credentialSource: {
            kind: "vault",
            credentialId: "11111111-1111-4111-8111-111111111111",
          },
        },
        credentials(),
      ),
    ).toMatchObject({
      credentials: credentials(),
      autoLogin: true,
      selectors: NPM_AUTO_LOGIN_SELECTORS,
    });
    expect(
      resolveHttpApplicationLogin({
        ...connection,
        httpApplication: { ...connection.httpApplication, loginMode: "manual" },
      }),
    ).toEqual({
      credentials: null,
      autoLogin: false,
      upstreamAuthMode: "none",
    });
  });
});
