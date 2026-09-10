import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANALYTICS_CMS_PROFILES } from "../../src/utils/connection/analyticsCmsProfiles";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import type { Connection } from "../../src/types/connection/connection";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";

const source = readFileSync(
  "src-tauri/crates/sorng-protocols/src/autologin_client.js",
  "utf8",
);
type Client = {
  bootstrap(
    credentials: { username: string | null; password: string | null },
    selectors: object,
  ): Promise<{ ok: boolean; reason: string }>;
  cancel(): void;
};
const connection = (
  id: string,
  loginMode: "manual" | "form" = "manual",
): Partial<Connection> => ({
  protocol: "https",
  hostname: "fixture.test",
  port: 443,
  username: "fixture@example.test",
  password: "fixture-password",
  httpAutoLogin: true,
  authType: "basic",
  httpHeaders: { Authorization: "Bearer must-not-be-used" },
  httpApplication: { version: 1, id, loginMode },
});
const forms = [
  {
    id: "matomo",
    html: '<form method="post" class="loginForm__form"><input id="login_form_login" name="form_login"><input id="login_form_password" name="form_password" type="password"><input id="login_form_submit" type="submit"><input type="hidden" name="form_nonce" value="fixture-csrf"></form><form id="reset_form"><input id="reset_form_login" name="form_login"><input id="reset_form_password" name="form_password" type="password"></form>',
  },
  {
    id: "plausible",
    html: '<form method="post" action="/login"><input name="email" type="email" autocomplete="username"><input id="current-password" name="password" type="password" autocomplete="current-password"><button type="submit">Sign in</button><input type="hidden" name="_csrf_token" value="fixture-csrf"></form>',
  },
  {
    id: "odoo",
    html: '<form class="oe_login_form" method="post" action="/web/login"><input name="db" value="chosen-database" readonly><input id="login" name="login"><input id="password" name="password" type="password"><button class="btn-primary" type="submit">Log in</button><button type="submit" name="redirect" value="/web/become">Superuser</button></form>',
  },
  {
    id: "phpmyadmin",
    html: '<form method="post" action="index.php?route=/" id="login_form" name="login_form"><input id="input_username" name="pma_username"><input id="input_password" name="pma_password" type="password"><select name="server"><option value="selected-server" selected>Selected server</option></select><input id="input_go" type="submit"></form>',
  },
];
let client: Client;
function mount(html: string) {
  document.body.innerHTML = html;
  for (const element of document.querySelectorAll("input,button"))
    Object.defineProperty(element, "offsetParent", {
      get: () => document.body,
    });
  const submit = vi.fn((event: Event) => event.preventDefault());
  document.querySelector("form")!.addEventListener("submit", submit);
  return submit;
}
describe("analytics and CMS profile contracts", () => {
  it("registers each requested profile once with manual defaults and no invented MFA", () => {
    expect(ANALYTICS_CMS_PROFILES.map((p) => p.id)).toEqual([
      "matomo",
      "plausible",
      "odoo",
      "ghost",
      "strapi",
      "phpmyadmin",
    ]);
    for (const profile of ANALYTICS_CMS_PROFILES) {
      expect(getHttpApplicationProfile(profile.id)).toBe(profile);
      expect(
        normalizeHttpApplicationSettings({ id: profile.id }),
      ).toMatchObject({ id: profile.id, loginMode: "manual" });
      expect(profile.totpChallenges).toBeUndefined();
      const external = getHttpApplicationExternalTarget(
        connection(profile.id),
        "https://fixture.test/current?session=private",
      );
      expect(external?.url).toBe(`https://fixture.test${profile.loginPath}`);
      expect(new URL(external!.url).search + new URL(external!.url).hash).toBe(
        "",
      );
      expect(resolveHttpApplicationLogin(connection(profile.id))).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
      expect(() =>
        validateHttpApplicationTarget(
          connection(profile.id),
          "http://fixture.test",
        ),
      ).toThrow("HTTPS");
      expect(() =>
        validateHttpApplicationTarget(
          connection(profile.id),
          "https://fixture.test",
        ),
      ).not.toThrow();
    }
  });
  it.each(["ghost", "strapi"])(
    "%s cannot silently enable automatic credentials",
    (id) => {
      expect(
        normalizeHttpApplicationSettings({ version: 1, id, loginMode: "form" })
          ?.invalid,
      ).toBe(true);
      expect(() =>
        resolveHttpApplicationLogin(connection(id, "form")),
      ).toThrow();
    },
  );
});
describe("real injected client against reviewed analytics/CMS DOM", () => {
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
  it.each(forms)(
    "$id fills only the reviewed account and submits once",
    async ({ id, html }) => {
      const submit = mount(html);
      const resolved = resolveHttpApplicationLogin(connection(id, "form"));
      const selectors = resolved.selectors!;
      const credentials = { ...resolved.credentials! };
      const result = await client.bootstrap(credentials, {
        username: selectors.usernameSelector,
        password: selectors.passwordSelector,
        submit: selectors.submitSelector,
      });
      expect(result).toMatchObject({ ok: true, reason: "submitted" });
      expect(submit).toHaveBeenCalledOnce();
      expect(
        (
          document.querySelector(
            selectors.usernameSelector!,
          ) as HTMLInputElement
        ).value,
      ).toBe("fixture@example.test");
      expect(
        (
          document.querySelector(
            selectors.passwordSelector!,
          ) as HTMLInputElement
        ).value,
      ).toBe("fixture-password");
      expect(credentials).toEqual({ username: null, password: null });
      expect(
        document.querySelector<HTMLInputElement>("#reset_form_password")
          ?.value ?? "",
      ).toBe("");
      expect(
        document.querySelector<HTMLInputElement>('[name="db"]')?.value ??
          "chosen-database",
      ).toBe("chosen-database");
      expect(
        document.querySelector<HTMLSelectElement>('[name="server"]')?.value ??
          "selected-server",
      ).toBe("selected-server");
      expect(
        document.querySelector<HTMLInputElement>('input[type="hidden"]')
          ?.value ?? "fixture-csrf",
      ).toBe("fixture-csrf");
      await vi.advanceTimersByTimeAsync(9000);
      expect(submit).toHaveBeenCalledOnce();
    },
  );
  it.each([
    {
      label: "cross-origin action",
      attributes: 'method="post" action="https://other.invalid/login"',
    },
    {
      label: "Ghost JavaScript action",
      attributes: 'method="post" action="javascript:void(0)"',
    },
    { label: "Strapi PUT form", attributes: 'method="PUT"' },
  ])("refuses $label before filling", async ({ attributes }) => {
    const submit = mount(
      `<form ${attributes}><input id="user"><input id="pass" type="password"><button id="submit" type="submit">Login</button></form>`,
    );
    const pending = client.bootstrap(
      { username: "fixture-account", password: "fixture-password" },
      { username: "#user", password: "#pass", submit: "#submit" },
    );
    await vi.advanceTimersByTimeAsync(9000);
    expect((await pending).ok).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLInputElement>("#pass")!.value).toBe("");
  });
});
