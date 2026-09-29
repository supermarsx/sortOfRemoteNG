import { describe, expect, it } from "vitest";
import { resolveHttpBookmarkUrl } from "../../src/utils/protocol/httpBookmarkUrl";

describe("website bookmark URLs", () => {
  const base = "https://panel.example.test:8443/login/";
  it.each([
    [
      "/files?view=list#home",
      "https://panel.example.test:8443/files?view=list#home",
    ],
    ["files", "https://panel.example.test:8443/files"],
    [
      " https://other.example.test/dashboard ",
      "https://other.example.test/dashboard",
    ],
    ["http://panel.example.test:8080/", "http://panel.example.test:8080/"],
    ["//other.example.test/path", "https://other.example.test/path"],
  ])("resolves %s without appending it to the login path", (path, expected) => {
    expect(resolveHttpBookmarkUrl(path, base)).toBe(expected);
  });
  it.each([
    "",
    " ",
    "javascript:alert(1)",
    "data:text/html,test",
    "file:///etc/passwd",
    "https://user:secret@panel.example.test/",
    "https://user@panel.example.test/",
    "https://[invalid",
    "https:\\example.test",
    "/file\nname",
    "/file\tname",
  ])("rejects unsafe or invalid target %j", (path) => {
    expect(resolveHttpBookmarkUrl(path, base)).toBe("");
  });

  describe("cPanel session rebasing", () => {
    const origin = "https://panel.example.test:8443";
    const current = `${origin}/cpsess987654/frontend/home.html`;

    it.each([
      "/cpsess123/frontend/files.html",
      "cpsess123/frontend/files.html",
      `${origin}/cpsess123/frontend/files.html`,
      "//panel.example.test:8443/cpsess123/frontend/files.html",
    ])("rebases the leading session in %s", (path) => {
      expect(resolveHttpBookmarkUrl(path, base, current)).toBe(
        `${origin}/cpsess987654/frontend/files.html`,
      );
    });

    it.each(["", "/", "?view=list#home", "?#"])(
      "rebases a token-only path with suffix %j",
      (suffix) => {
        expect(
          resolveHttpBookmarkUrl(`/cpsess123${suffix}`, base, current),
        ).toBe(`${origin}/cpsess987654${suffix}`);
      },
    );

    it.each(["", "/", "?view=list#home"])(
      "accepts a token-only current path with suffix %j",
      (suffix) => {
        expect(
          resolveHttpBookmarkUrl(
            "/cpsess123/files",
            base,
            `${origin}/cpsess0009${suffix}`,
          ),
        ).toBe(`${origin}/cpsess0009/files`);
      },
    );

    it("preserves nested tokens and raw path, query, and hash encoding", () => {
      const suffix =
        "/a%2fb/%7e/cpsess123/file?next=/cpsess123/&encoded=%2f%2F&space=+%20&x=1&x=2#cpsess123/%2f";
      expect(resolveHttpBookmarkUrl(`/cpsess123${suffix}`, base, current)).toBe(
        `${origin}/cpsess987654${suffix}`,
      );
    });

    it.each([
      "/files?next=/cpsess123/#/cpsess123",
      "/nested/cpsess123/files",
      "/cpsess/files",
      "/cpsess123abc/files",
      "/cpsess123;param/files",
      "/CPSESS123/files",
      "/cpsess１２３/files",
      "/cpsess%31/files",
      "/cpsess123%2ffiles",
    ])(
      "leaves non-session or malformed bookmark paths unchanged: %s",
      (path) => {
        expect(resolveHttpBookmarkUrl(path, base, current)).toBe(
          resolveHttpBookmarkUrl(path, base),
        );
      },
    );

    it.each([
      "https://other.example.test:8443",
      "https://panel.example.test",
      "https://panel.example.test:2083",
      "http://panel.example.test:8443",
    ])("does not transfer sessions across origins: %s", (otherOrigin) => {
      const otherBookmark = `${otherOrigin}/cpsess123/files`;
      const otherCurrent = `${otherOrigin}/cpsess999/home`;
      expect(resolveHttpBookmarkUrl(otherBookmark, base, current)).toBe(
        otherBookmark,
      );
      expect(
        resolveHttpBookmarkUrl("/cpsess123/files", base, otherCurrent),
      ).toBe(`${origin}/cpsess123/files`);
      // Even matching bookmark/document origins must match the saved origin.
      expect(resolveHttpBookmarkUrl(otherBookmark, base, otherCurrent)).toBe(
        otherBookmark,
      );
    });

    it.each([
      undefined,
      "",
      "not a URL",
      "/cpsess999/home",
      "//panel.example.test:8443/cpsess999/home",
      "https://[invalid",
      `${origin}/home`,
      `${origin}/nested/cpsess999/home`,
      `${origin}/cpsess/home`,
      `${origin}/cpsess999abc/home`,
      `${origin}/cpsess999;param/home`,
      `${origin}/CPSESS999/home`,
      `${origin}/cpsess%39/home`,
      `${origin}/cpsess999%2fhome`,
      "https://user:secret@panel.example.test:8443/cpsess999/home",
      "https://user@panel.example.test:8443/cpsess999/home",
      "https://:secret@panel.example.test:8443/cpsess999/home",
      `${origin}/cpsess999\\home`,
      `${origin}/cpsess999/ho\nme`,
      `\t${origin}/cpsess999/home`,
      `${origin}/cpsess999/home\r`,
      `${origin}/cpsess999/home\u0000`,
      `${origin}/cpsess999/home\u007f`,
      "file:///cpsess999/home",
      "javascript:alert(1)",
    ])(
      "keeps existing resolution for invalid current documents: %j",
      (document) => {
        expect(
          resolveHttpBookmarkUrl("/cpsess123/files?x=%2f#home", base, document),
        ).toBe(`${origin}/cpsess123/files?x=%2f#home`);
      },
    );

    it("keeps the two-argument signature unchanged for session bookmarks", () => {
      expect(resolveHttpBookmarkUrl("/cpsess123/files", base)).toBe(
        `${origin}/cpsess123/files`,
      );
    });

    it("supports same-origin HTTP sessions", () => {
      expect(
        resolveHttpBookmarkUrl(
          "/cpsess123/files",
          "http://panel.example.test/login",
          "http://panel.example.test/cpsess456/home",
        ),
      ).toBe("http://panel.example.test/cpsess456/files");
    });
  });
});
