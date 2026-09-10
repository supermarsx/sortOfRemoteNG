import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import {
  prepareConnectionForClone,
  prepareConnectionForExport,
  normalizeImportedAdvancedProtocolConnection,
} from "../../src/components/ImportExport/advancedProtocolPortability";
import type { Connection } from "../../src/types/connection/connection";

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
  it("uses the reviewed Joomla POST form even when its entry slug differs from its action", async () => {
    const source = readFileSync(
      "src-tauri/crates/sorng-protocols/src/autologin_client.js",
      "utf8",
    );
    const ready = Object.getOwnPropertyDescriptor(document, "readyState");
    Object.defineProperty(document, "readyState", {
      configurable: true,
      value: "complete",
    });
    document.body.innerHTML =
      '<form id="form-login" method="post" action="/administrator/index.php"><input id="mod-login-username" name="username"><input id="mod-login-password" name="passwd" type="password"><button id="btn-login-submit" type="submit">Log in</button><input type="hidden" name="fixture-csrf" value="1"></form>';
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
          bootstrap(creds: object, selectors: object): Promise<{ ok: boolean }>;
          cancel(): void;
        };
      }
    ).__sorng_autologin;
    try {
      const login = resolveHttpApplicationLogin(connection("/staff-entry/"));
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
  });
});
