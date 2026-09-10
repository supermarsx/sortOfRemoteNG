import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHttpApplicationProfile } from "../../src/utils/connection/httpApplicationProfiles";

// Reduced DOM fixtures reproduce the reviewed controls, not a running provider.
// GitLab fa8866a33046ee6ab803291d3a38810f16d395b0 sign_in_form.vue.
// SQLPad 57cc866b4c5e8cb5a1964d6a58a789e76853d537 pages/SignIn.tsx.
const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
type Client = {
  bootstrap(
    creds: { username: string | null; password: string | null },
    selectors: object,
  ): Promise<{ ok: boolean; reason: string }>;
  cancel(): void;
};
let client: Client;
function prepare(html: string, preventForm = true) {
  document.body.innerHTML = html;
  for (const element of document.querySelectorAll("input,button"))
    Object.defineProperty(element, "offsetParent", {
      get: () => document.body,
    });
  const submit = vi.fn((event: Event) => {
    if (preventForm) event.preventDefault();
  });
  document.querySelector("form")!.addEventListener("submit", submit);
  return submit;
}
function run(id: string, username = "fixture-account") {
  const s = getHttpApplicationProfile(id)!.selectors!;
  return client.bootstrap(
    { username, password: "fixture-secret" },
    {
      username: s.usernameSelector,
      password: s.passwordSelector,
      submit: s.submitSelector,
    },
  );
}
const gitlab = `<form id="sign-in-form" method="post" action="/users/sign_in"><input type="hidden" name="authenticity_token" value="site-managed"><input name="user[login]" autocomplete="username" data-testid="username-field"><input type="password" name="user[password]" data-testid="password-field"><button type="submit" data-testid="sign-in-button">Sign in</button></form><form action="/users/sign_in/passkey" method="post"><button type="submit">Passkey</button></form>`;
const sqlpad = `<form><input name="email" type="email"><input name="password" type="password"><button type="submit">Sign in</button><a href="/auth/oidc">Identity provider</a></form>`;

describe("actual injected login client with reviewed dashboard forms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
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
    vi.useRealTimers();
  });
  it("fills GitLab's simultaneous local form once, preserves CSRF and leaves passkey untouched", async () => {
    const submit = prepare(gitlab);
    const passkey = vi.fn();
    document.querySelectorAll("form")[1].addEventListener("submit", passkey);
    expect(await run("gitlab-self-hosted")).toMatchObject({
      ok: true,
      reason: "submitted",
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(passkey).not.toHaveBeenCalled();
    expect(
      (document.querySelector('[name="user[login]"]') as HTMLInputElement)
        .value,
    ).toBe("fixture-account");
    expect(
      (document.querySelector('[name="user[password]"]') as HTMLInputElement)
        .value,
    ).toBe("fixture-secret");
    expect(
      (
        document.querySelector(
          '[name="authenticity_token"]',
        ) as HTMLInputElement
      ).value,
    ).toBe("site-managed");
    await vi.advanceTimersByTimeAsync(60000);
    expect(submit).toHaveBeenCalledOnce();
  });
  it("does not fill a GitLab username-only routing stage or a separate unrelated password form", async () => {
    prepare(
      gitlab.replace(
        '<input type="password" name="user[password]" data-testid="password-field">',
        "",
      ) + '<form><input type="password"><button>Other</button></form>',
    );
    const pending = run("gitlab-self-hosted");
    await vi.advanceTimersByTimeAsync(9000);
    expect(await pending).toMatchObject({ ok: false });
    expect(
      (document.querySelector('[name="user[login]"]') as HTMLInputElement)
        .value,
    ).toBe("");
  });
  it("fills SQLPad's controlled SPA inputs and clicks only its local submit with GET navigation suppressed", async () => {
    const submit = prepare(sqlpad, false);
    const values: Record<string, string> = {};
    document.querySelectorAll("input").forEach((el) =>
      el.addEventListener("input", () => {
        values[el.name] = el.value;
      }),
    );
    expect(await run("sqlpad", "fixture@example.test")).toMatchObject({
      ok: true,
      reason: "submitted",
    });
    expect(values).toEqual({
      email: "fixture@example.test",
      password: "fixture-secret",
    });
    expect(submit).toHaveBeenCalledOnce();
    expect((submit.mock.calls[0][0] as Event).defaultPrevented).toBe(true);
  });
  it("runs SQLPad's own click handler with an LDAP username without triggering native form navigation", async () => {
    const submit = prepare(sqlpad, false);
    const signIn = vi.fn((event: Event) => event.preventDefault());
    document.querySelector("button")!.addEventListener("click", signIn);
    expect(await run("sqlpad")).toMatchObject({
      ok: true,
      reason: "submitted",
    });
    expect(signIn).toHaveBeenCalledOnce();
    expect(submit).not.toHaveBeenCalled();
    expect(
      (document.querySelector('[name="email"]') as HTMLInputElement).value,
    ).toBe("fixture-account");
  });
  it.each([
    ["gitlab-self-hosted", gitlab],
    ["sqlpad", sqlpad],
  ])(
    "%s refuses a cross-origin form action before filling",
    async (id, html) => {
      prepare(html);
      document.querySelector("form")!.action = "https://other.test/collect";
      expect(await run(id)).toMatchObject({
        ok: false,
        reason: "unsafe-form-action",
      });
      expect(
        Array.from(
          document.querySelectorAll('input:not([type="hidden"])'),
        ).every((el) => (el as HTMLInputElement).value === ""),
      ).toBe(true);
    },
  );
  it("does not mistake SQLPad SSO for a local form", async () => {
    document.body.innerHTML = '<a href="/auth/oidc">Single sign-on</a>';
    const pending = run("sqlpad");
    await vi.advanceTimersByTimeAsync(9000);
    expect(await pending).toMatchObject({ ok: false });
  });
});
