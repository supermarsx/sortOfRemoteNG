import { describe, expect, it, vi } from "vitest";
import { readHttpBookmarkDrop } from "../../src/utils/protocol/httpBookmarkDrop";
import type { GoogleProxyRoute } from "../../src/utils/protocol/googleProxySession";

const proxyOrigin = `http://p${"a".repeat(32)}.localhost:43127`;
const accountOrigin = `http://p${"b".repeat(32)}.localhost:43127`;
const resourceOrigin = `http://p${"c".repeat(32)}.localhost:43127`;
const context = {
  proxyOrigin,
  upstreamUrl: "https://nas.example.test:5001/login/",
};
const routes: GoogleProxyRoute[] = [
  { proxyOrigin, upstreamOrigin: "https://drive.google.com", documents: true },
  {
    proxyOrigin: accountOrigin,
    upstreamOrigin: "https://accounts.google.com",
    documents: true,
  },
  {
    proxyOrigin: resourceOrigin,
    upstreamOrigin: "https://www.gstatic.com",
    documents: false,
  },
];
const drop = (text: string, type = "text/plain") => ({
  getData: vi.fn((format: string) => (format === type ? text : "")),
});
const item = (path: string) => ({ name: new URL(path).host, path });

describe("browser bookmark drops", () => {
  it("reads CRLF URI lists, ignores comments, canonicalizes and deduplicates", () => {
    expect(
      readHttpBookmarkDrop(
        drop(
          "# browser links\r\nHTTPS://EXAMPLE.TEST/a\r\n\r\nhttps://example.test/a\r\nhttp://other.test:8080/b#here\r\n",
          "text/uri-list",
        ),
      ),
    ).toEqual([
      item("https://example.test/a"),
      item("http://other.test:8080/b#here"),
    ]);
  });

  it("prefers URI lists and never reads dropped HTML", () => {
    const data = {
      getData: vi.fn(
        (type: string) =>
          ({
            "text/uri-list": "https://example.test/list",
            "text/plain": "https://example.test/plain",
            "text/html": '<a href="javascript:alert(1)">Link</a>',
          })[type] ?? "",
      ),
    };
    expect(readHttpBookmarkDrop(data)).toEqual([
      item("https://example.test/list"),
    ]);
    expect(data.getData.mock.calls).toEqual([["text/uri-list"]]);
    expect(
      readHttpBookmarkDrop(
        drop('<a href="https://example.test/">Link</a>', "text/html"),
      ),
    ).toEqual([]);
  });

  it("projects a NAS link and removes only native navigation keys", () => {
    expect(
      readHttpBookmarkDrop(
        drop(
          `${proxyOrigin}/webman/index.cgi?name=a%20b&flag&x=%2f&__sorng_navigation_v1=secret&__sorng_%67eneration_v1=old&__sorng_navigation_v1=again#files`,
        ),
        context,
      ),
    ).toEqual([
      item(
        "https://nas.example.test:5001/webman/index.cgi?name=a%20b&flag&x=%2f#files",
      ),
    ]);
  });

  it("projects registered Google document routes before the current-origin fallback", () => {
    expect(
      readHttpBookmarkDrop(
        drop(
          `${proxyOrigin}/drive/u/0?__sorng_navigation_v1=n#folders\r\n${accountOrigin}/ServiceLogin?continue=https%3A%2F%2Fdrive.google.com&__sorng_generation_v1=g`,
          "text/uri-list",
        ),
        { ...context, routes },
      ),
    ).toEqual([
      item("https://drive.google.com/drive/u/0#folders"),
      item(
        "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fdrive.google.com",
      ),
    ]);
  });

  it("preserves double-slash paths without changing upstream authority", () => {
    for (const extra of [{}, { routes }]) {
      const result = readHttpBookmarkDrop(
        drop(`${proxyOrigin}//evil.test/path?q=1#ok`),
        { ...context, ...extra },
      );
      expect(result).toEqual([
        item(
          `${extra.routes ? "https://drive.google.com" : "https://nas.example.test:5001"}//evil.test/path?q=1#ok`,
        ),
      ]);
    }
  });

  it("leaves external marker keys and opaque queries unchanged", () => {
    const url =
      "https://external.test/path?x=a%20b&flag&__sorng_navigation_v1=user&__sorng_generation_v1=value#hash";
    expect(readHttpBookmarkDrop(drop(url), { ...context, routes })).toEqual([
      item(url),
    ]);
  });

  it("deduplicates after projection and marker removal", () => {
    expect(
      readHttpBookmarkDrop(
        drop(
          `${proxyOrigin}/files?__sorng_navigation_v1=n\nhttps://nas.example.test:5001/files\n${proxyOrigin}/files?__sorng_generation_v1=g`,
          "text/uri-list",
        ),
        context,
      ),
    ).toEqual([item("https://nas.example.test:5001/files")]);
  });

  it.each([
    "",
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///C:/test.txt",
    "C:\\test.txt",
    "/relative/path",
    "//example.test/path",
    "https:///example.test",
    "https://user:secret@example.test/",
    "https://user@example.test/",
    "https://[invalid",
    "https://example.test/\\evil",
    "https://example.test/\tpath",
    "https://example.test/\u0000",
    "https://example.test/\u007f",
    "\nhttps://example.test/",
    "https://example.test/\r\n",
    "https://one.test/\nhttps://two.test/",
    "https://one.test/ https://two.test/",
    '<a href="https://example.test/">Link</a>',
    "https://example.test/<script>alert(1)</script>",
  ])("rejects invalid plain text %j", (value) => {
    expect(readHttpBookmarkDrop(drop(value), context)).toEqual([]);
  });

  it("rejects unknown protected aliases and mismatched schemes/ports", () => {
    for (const url of [
      accountOrigin,
      accountOrigin.replace(".localhost:", ".localhost.:"),
      proxyOrigin.replace("43127", "43128"),
      proxyOrigin.replace("http:", "https:"),
    ]) {
      expect(readHttpBookmarkDrop(drop(url), context)).toEqual([]);
    }
    expect(readHttpBookmarkDrop(drop(`${proxyOrigin}/files`))).toEqual([]);
    expect(
      readHttpBookmarkDrop(drop(`${proxyOrigin}/files`), { proxyOrigin }),
    ).toEqual([]);
  });

  it("rejects resource routes even when passed as the current proxy", () => {
    expect(
      readHttpBookmarkDrop(drop(`${resourceOrigin}/asset.js`), {
        ...context,
        proxyOrigin: resourceOrigin,
        routes,
      }),
    ).toEqual([]);
  });

  it.each([
    "/__sorng",
    "/__sorng/credentials",
    "/__sorng_navigation_v1",
    "/__sortofremoteng_autologin",
    "/__sortofremoteng_assets_v1/client.js",
    "/__sortofremoteng_google_cookie_v1",
    "/__sortofremoteng_quickconnect_redirect_v1",
    "/__sortofremoteng_quickconnect_control_v1",
    "/__sortofremoteng_quickconnect_discovered_v1",
    "/__sortofremoteng_tactical_rmm_api_v1",
    "/__sortofremoteng_web_darkreader_v1.js",
    "/%5f%5fsorng/secret",
    "/%5f%5fsorng/secret%invalid",
    "/x/../__sortofremoteng_autologin",
  ])("rejects internal endpoint %s", (path) => {
    expect(readHttpBookmarkDrop(drop(proxyOrigin + path), context)).toEqual([]);
    expect(
      readHttpBookmarkDrop(drop(accountOrigin + path), { routes }),
    ).toEqual([]);
  });

  it("supports exact legacy loopback origins but does not project other origins", () => {
    const legacy = { ...context, proxyOrigin: "http://127.0.0.1:43127" };
    expect(
      readHttpBookmarkDrop(drop("http://127.0.0.1:43127/files"), legacy),
    ).toEqual([item("https://nas.example.test:5001/files")]);
    expect(
      readHttpBookmarkDrop(drop("http://localhost:43127/files"), legacy),
    ).toEqual([item("http://localhost:43127/files")]);
  });

  it("rejects oversized input in either text format, including multibyte input", () => {
    for (const type of ["text/plain", "text/uri-list"]) {
      expect(
        readHttpBookmarkDrop(
          drop("https://example.test/" + "a".repeat(65536), type),
        ),
      ).toEqual([]);
      expect(
        readHttpBookmarkDrop(
          drop("https://example.test/" + "é".repeat(32768), type),
        ),
      ).toEqual([]);
    }
    const atLimit = "https://example.test/".padEnd(65536, "a");
    expect(readHttpBookmarkDrop(drop(atLimit))).toEqual([item(atLimit)]);
  });

  it("caps output at 32 unique URLs, without counting invalid or duplicate entries", () => {
    const urls = Array.from(
      { length: 40 },
      (_, index) => `https://example.test/${index}`,
    );
    const input = ["javascript:alert(1)", urls[0], ...urls].join("\n");
    expect(readHttpBookmarkDrop(drop(input, "text/uri-list"))).toEqual(
      urls.slice(0, 32).map(item),
    );
  });
});
