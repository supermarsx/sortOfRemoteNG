import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getReviewedApplicationProfile } from "../../src/utils/auth/httpApplicationLogin";

const bridge = readFileSync(
  "src-tauri/crates/sorng-protocols/src/freepbx_cookie_compat.js",
  "utf8",
);
const library = readFileSync(
  "tests/protocol/fixtures/freepbx-js-cookie-2.1.3.js",
  "utf8",
);
type CookieOptions = { path?: string; domain?: string; secure?: boolean };
type JQueryFixture = {
  fn: { jquery: string };
  removeCookie?: (key: string, options?: CookieOptions) => boolean;
};
const page = window as unknown as {
  jQuery?: JQueryFixture;
  Cookies?: {
    get(key: string): string | undefined;
    set(key: string, value: string, options?: CookieOptions): void;
    remove(key: string, options?: CookieOptions): void;
  };
};
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  delete page.jQuery;
  delete page.Cookies;
  document.cookie = "fixture=;path=/;max-age=0";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("FreePBX signed-out navbar preflight", () => {
  type Options = { type: string; dataType: string; url: string; data?: string };
  type Request = { abort(reason: string): void };
  function setup(existingHelper = false) {
    const origin = "http://p0123456789abcdef0123456789abcdef.localhost:43123";
    vi.stubGlobal("location", new URL(origin + "/admin/"));
    vi.spyOn(document, "baseURI", "get").mockReturnValue(origin + "/admin/");
    document.body.innerHTML =
      '<a id="login_admin" class="login_item" href="/admin/">Admin</a><div id="login_form"><form id="loginform"><input type="text" name="username"><input type="password" name="password"></form></div>';
    let filter!: (
      options: Options,
      original: Options,
      request: Request,
    ) => void;
    const jq = {
      fn: { jquery: "3.1.1" },
      ajaxPrefilter: vi.fn((next: typeof filter) => {
        filter = next;
      }),
      ...(existingHelper ? { removeCookie: vi.fn(() => true) } : {}),
    };
    page.jQuery = jq;
    window.eval(bridge);
    const options: Options = {
      type: "POST",
      dataType: "json",
      url: "ajax.php?command=navbarToogle",
    };
    const abort = vi.fn();
    return {
      jq,
      options,
      abort,
      run: () => filter(options, options, { abort }),
    };
  }
  it.each([false, true])(
    "cancels only the optional signed-out request even with existing cookie helper: %s",
    (existing) => {
      const fixture = setup(existing);
      const helper = fixture.jq.removeCookie;
      fixture.run();
      expect(fixture.abort).toHaveBeenCalledExactlyOnceWith(
        "freepbx-navbar-requires-login",
      );
      expect(fixture.jq.removeCookie).toBe(helper);
    },
  );
  it.each([
    { url: "ajax.php?command=navbarToogle&click=true" },
    { url: "ajax.php?command=navbarToogle&command=navbarToogle" },
    { url: "ajax.php?command=navbarToogle&command=other" },
    { url: "ajax.php?command=navbarToogle&extra=true" },
    { url: "ajax.php?command=authping" },
    { url: "ajax.php?command=navbarToogle#fragment" },
    { url: "https://foreign.example/admin/ajax.php?command=navbarToogle" },
    {
      url: "https://user:password@foreign.example/admin/ajax.php?command=navbarToogle",
    },
    { url: "/other/ajax.php?command=navbarToogle" },
    { url: "https://[" },
    { type: "GET" },
    { dataType: "html" },
    { data: "username=fixture&password=private" },
  ])("leaves non-matching requests untouched: %j", (change) => {
    const fixture = setup();
    Object.assign(fixture.options, change);
    fixture.run();
    expect(fixture.abort).not.toHaveBeenCalled();
  });
  it.each(["#login_admin", "#login_form", 'input[name="password"]'])(
    "leaves authenticated/unknown layouts untouched when %s is absent",
    (selector) => {
      const fixture = setup();
      document.querySelector(selector)!.remove();
      fixture.run();
      expect(fixture.abort).not.toHaveBeenCalled();
    },
  );
  it("stops acting after pagehide", () => {
    const fixture = setup();
    window.dispatchEvent(new Event("pagehide"));
    fixture.run();
    expect(fixture.abort).not.toHaveBeenCalled();
  });
});
function installLibraries(reverse = false) {
  if (reverse) window.eval(library);
  page.jQuery = { fn: { jquery: "3.1.1" } };
  if (!reverse) window.eval(library);
  return page.jQuery;
}
describe("reviewed FreePBX cookie API adapter", () => {
  it.each([false, true])(
    "installs synchronously as libraries load (Cookies first: %s)",
    (reverse) => {
      window.eval(bridge);
      const jq = installLibraries(reverse);
      expect(jq.removeCookie).toBeTypeOf("function");
      expect(
        Object.getOwnPropertyDescriptor(window, "jQuery")?.get,
      ).toBeUndefined();
      expect(
        Object.getOwnPropertyDescriptor(window, "Cookies")?.get,
      ).toBeUndefined();
      expect(jq.removeCookie!("fixture", { path: "/" })).toBe(false);
      page.Cookies!.set("fixture", "value", { path: "/" });
      expect(jq.removeCookie!("fixture", { path: "/" })).toBe(true);
      expect(page.Cookies!.get("fixture")).toBeUndefined();
    },
  );
  it("preserves options and returns false if the cookie remains", () => {
    const jq = installLibraries();
    window.eval(bridge);
    page.Cookies!.set("fixture", "value");
    const remove = vi
      .spyOn(page.Cookies!, "remove")
      .mockImplementation(() => {});
    const options = { path: "/admin", domain: "pbx.example", secure: true };
    expect(jq.removeCookie!("fixture", options)).toBe(false);
    expect(remove).toHaveBeenCalledExactlyOnceWith("fixture", options);
    expect(options).toEqual({
      path: "/admin",
      domain: "pbx.example",
      secure: true,
    });
  });
  it("does not overwrite an existing helper", () => {
    const jq = installLibraries();
    const existing = vi.fn(() => false);
    jq.removeCookie = existing;
    window.eval(bridge);
    expect(jq.removeCookie).toBe(existing);
  });
  it("releases pending global watchers on pagehide when Cookies never loads", () => {
    window.eval(bridge);
    const jq = { fn: { jquery: "3.1.1" } };
    page.jQuery = jq;
    expect(Object.getOwnPropertyDescriptor(window, "Cookies")?.get).toBeTypeOf(
      "function",
    );
    window.dispatchEvent(new Event("pagehide"));
    expect(page.jQuery).toBe(jq);
    expect(
      Object.getOwnPropertyDescriptor(window, "jQuery")?.get,
    ).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(window, "Cookies")).toBeUndefined();
    window.eval(library);
    expect(page.jQuery?.removeCookie).toBeUndefined();
  });
  it("does not create cookies, fetch credentials, or perform logout on installation", () => {
    const jq = installLibraries();
    const remove = vi.spyOn(page.Cookies!, "remove");
    const set = vi.spyOn(page.Cookies!, "set");
    window.eval(bridge);
    expect(remove).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(jq.removeCookie!("missing")).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });
  it("allows the upstream 401 -> logout callback to finish without swallowing 401", () => {
    window.eval(bridge);
    const jq = installLibraries();
    const getCookie = vi
      .spyOn(page.Cookies!, "get")
      .mockReturnValueOnce("session")
      .mockReturnValue(undefined);
    const remove = vi
      .spyOn(page.Cookies!, "remove")
      .mockImplementation(() => {});
    const navigate = vi.fn();
    const get = vi.fn((_url: string, callback: () => void) => callback());
    // Reduced script.legacy.js ajaxError branch from pinned FreePBX16;
    // only navigation is recorded instead of reloading the test document.
    const status = 401;
    if (status === 401) {
      const url = "/admin/";
      get(url + "?logout=true", () => {
        jq.removeCookie!("PHPSESSID", { path: "/" });
        navigate(url);
      });
    }
    expect(get).toHaveBeenCalledWith(
      "/admin/?logout=true",
      expect.any(Function),
    );
    expect(remove).toHaveBeenCalledExactlyOnceWith("PHPSESSID", { path: "/" });
    expect(getCookie).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenCalledExactlyOnceWith("/admin/");
  });
  it.each(["manual", "form"] as const)(
    "derives the reviewed marker independently of login mode: %s",
    (loginMode) => {
      expect(
        getReviewedApplicationProfile({
          httpApplication: { version: 1, id: "freepbx", loginMode },
        }),
      ).toBe("freepbx");
    },
  );
  it.each([undefined, "generic", "porkbun", "cpanel"])(
    "does not select the FreePBX adapter for %s",
    (id) => {
      expect(
        getReviewedApplicationProfile(
          id
            ? { httpApplication: { version: 1, id, loginMode: "manual" } }
            : {},
        ),
      ).not.toBe("freepbx");
      const jq = installLibraries();
      expect(jq.removeCookie).toBeUndefined();
    },
  );
});
