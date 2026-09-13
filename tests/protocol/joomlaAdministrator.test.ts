import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  getHttpApplicationProfile,
  getJoomlaLoginSelectors,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import {
  prepareConnectionForClone,
  prepareConnectionForExport,
  normalizeImportedAdvancedProtocolConnection,
} from "../../src/components/ImportExport/advancedProtocolPortability";
import type {
  Connection,
  HttpApplicationSettings,
} from "../../src/types/connection/connection";

const connection = (loginPath?: string): Connection => ({
  id: "fixture",
  name: "Joomla",
  protocol: "https",
  hostname: "joomla.test",
  port: 8443,
  isGroup: false,
  createdAt: "2026-09-10T00:00:00Z",
  updatedAt: "2026-09-10T00:00:00Z",
  username: "fixture-user",
  password: "fixture-password",
  httpApplication: {
    version: 1,
    id: "joomla",
    loginMode: "form",
    ...(loginPath ? { loginPath } : {}),
  },
});
describe("Joomla administrator entry paths", () => {
  it.each([undefined, "auto", "3", "4", "5", "6"] as const)(
    "preserves version %s across portable copies without adding consent",
    (joomlaVersion) => {
      const saved = connection("/site/administrator/");
      saved.httpApplication = {
        ...saved.httpApplication!,
        loginMode: "manual",
        joomlaVersion,
      };
      for (const copy of [
        saved,
        prepareConnectionForExport(saved, false),
        prepareConnectionForClone(saved, false),
        normalizeImportedAdvancedProtocolConnection(saved),
      ]) {
        expect(normalizeHttpApplicationSettings(copy.httpApplication)).toEqual(
          saved.httpApplication,
        );
        expect(resolveHttpApplicationLogin(copy)).toMatchObject({
          autoLogin: false,
          credentials: null,
          upstreamAuthMode: "none",
        });
        expect(copy.httpAutoMfa?.enabled).not.toBe(true);
      }
    },
  );
  it.each([null, 3, "7", "4.2", {}, true])(
    "rejects malformed version %j without legacy auth fallback",
    (joomlaVersion) => {
      const saved = connection();
      saved.httpApplication = {
        ...saved.httpApplication!,
        joomlaVersion,
      } as HttpApplicationSettings;
      expect(
        normalizeHttpApplicationSettings(saved.httpApplication)?.invalid,
      ).toBe(true);
      expect(() => resolveHttpApplicationLogin(saved)).toThrow(/invalid/);
    },
  );
  it("rejects Joomla metadata on another application", () => {
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "wordpress",
        loginMode: "form",
        joomlaVersion: "3",
      })?.invalid,
    ).toBe(true);
  });
  it("keeps explicit selectors authoritative across version changes", () => {
    const saved = connection();
    saved.httpAutoLoginSelectors = {
      submitSelector: "#reviewed-custom-submit",
    };
    for (const joomlaVersion of ["auto", "3", "4", "5", "6"] as const) {
      saved.httpApplication = { ...saved.httpApplication!, joomlaVersion };
      expect(resolveHttpApplicationLogin(saved).selectors).toEqual({
        ...getJoomlaLoginSelectors(joomlaVersion),
        submitSelector: "#reviewed-custom-submit",
      });
    }
  });
  it("selects only the chosen generation's submit control, never password toggles", () => {
    const fragment = document.createElement("div");
    fragment.innerHTML =
      '<form id="form-login"><button class="login-button">Legacy</button><button id="btn-login-submit" type="submit">Modern</button><button class="login-button" type="button">Toggle</button></form>';
    expect(
      fragment.querySelectorAll(getJoomlaLoginSelectors("3").submitSelector!),
    ).toHaveLength(1);
    expect(
      fragment.querySelectorAll(getJoomlaLoginSelectors("6").submitSelector!),
    ).toHaveLength(1);
    expect(
      fragment.querySelectorAll(getJoomlaLoginSelectors().submitSelector!),
    ).toHaveLength(2);
  });
  it.each([
    undefined,
    "/site/administrator/",
    "/staff-entry/",
    "/portal/admin-login",
  ])(
    "round-trips safe explicit path %s and builds a secret-free same-origin handoff",
    (loginPath) => {
      const saved = connection(loginPath);
      expect(getHttpApplicationProfile("joomla")?.loginPath).toBe(
        "/administrator/",
      );
      expect(normalizeHttpApplicationSettings(saved.httpApplication)).toEqual(
        saved.httpApplication,
      );
      for (const copy of [
        prepareConnectionForExport(saved, false),
        prepareConnectionForClone(saved, false),
        normalizeImportedAdvancedProtocolConnection(saved),
      ])
        expect(copy.httpApplication).toEqual(saved.httpApplication);
      expect(
        getHttpApplicationExternalTarget(
          saved,
          "https://joomla.test:8443/previous?token=private#private",
        )?.url,
      ).toBe(`https://joomla.test:8443${loginPath ?? "/administrator/"}`);
    },
  );
  it.each([
    "//other.test/",
    "https://other.test/",
    "/administrator/?secret=x",
    "/admin#key",
    "/a/../admin/",
    "/a/./admin/",
    "/a%2fadmin",
    "/admin\\test",
    "/admin\n",
    "/" + "a".repeat(512),
  ])("fails closed on unsafe imported path %j", (loginPath) => {
    const saved = connection(loginPath);
    const normalized = normalizeHttpApplicationSettings(saved.httpApplication);
    expect(normalized?.invalid).toBe(true);
    expect(normalized?.loginPath).toBeUndefined();
    expect(() => resolveHttpApplicationLogin(saved)).toThrow();
    expect(
      getHttpApplicationExternalTarget(saved, "https://joomla.test:8443/"),
    ).toBeNull();
  });
  it("does not allow an imported path to retarget a hosted provider", () => {
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "github",
        loginMode: "manual",
        loginPath: "/other/",
      })?.invalid,
    ).toBe(true);
  });
  it.each(["auto", "3", "4", "5", "6"] as const)(
    "submits version %s's reviewed POST form at a custom entry slug",
    async (joomlaVersion) => {
      const source = readFileSync(
        "src-tauri/crates/sorng-protocols/src/autologin_client.js",
        "utf8",
      );
      const ready = Object.getOwnPropertyDescriptor(document, "readyState");
      Object.defineProperty(document, "readyState", {
        configurable: true,
        value: "complete",
      });
      const submit =
        joomlaVersion === "3"
          ? '<button class="login-button">Log in</button>'
          : '<button id="btn-login-submit" type="submit">Log in</button>';
      document.body.innerHTML =
        '<form id="form-login" method="post" action="/administrator/index.php"><input id="mod-login-username" name="username"><input id="mod-login-password" name="passwd" type="password">' +
        submit +
        '<input type="hidden" name="fixture-csrf" value="1"></form>';
      for (const input of document.querySelectorAll("input,button"))
        Object.defineProperty(input, "offsetParent", {
          get: () => document.body,
        });
      let count = 0;
      document.querySelector("form")!.addEventListener("submit", (event) => {
        event.preventDefault();
        count++;
      });
      window.eval(source);
      const client = (
        window as unknown as {
          __sorng_autologin: {
            bootstrap(
              creds: object,
              selectors: object,
            ): Promise<{ ok: boolean }>;
            cancel(): void;
          };
        }
      ).__sorng_autologin;
      try {
        const saved = connection("/staff-entry/");
        saved.httpApplication = { ...saved.httpApplication!, joomlaVersion };
        const login = resolveHttpApplicationLogin(saved);
        expect(
          await client.bootstrap(
            { ...login.credentials },
            {
              username: login.selectors!.usernameSelector,
              password: login.selectors!.passwordSelector,
              submit: login.selectors!.submitSelector,
            },
          ),
        ).toMatchObject({ ok: true });
        expect(count).toBe(1);
        expect(
          document.querySelector<HTMLInputElement>('[name="passwd"]')!.value,
        ).toBe("fixture-password");
        expect(
          document.querySelector<HTMLInputElement>('[name="fixture-csrf"]')!
            .value,
        ).toBe("1");
      } finally {
        client.cancel();
        window.removeEventListener("pagehide", client.cancel);
        window.removeEventListener("unload", client.cancel);
        Reflect.deleteProperty(window, "__sorng_autologin");
        Reflect.deleteProperty(window, "__autologin_last");
        if (ready) Object.defineProperty(document, "readyState", ready);
        else Reflect.deleteProperty(document, "readyState");
        document.body.innerHTML = "";
      }
    },
  );
});
