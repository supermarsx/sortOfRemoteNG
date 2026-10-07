import { describe, expect, it } from "vitest";
import { externalWebLink } from "../../src/utils/protocol/webExternalLink";

const source = "https://mail.example.test";
describe("external email link validation", () => {
  it.each([
    "https://news.example.test/article?a=one%20two&signature=a%2Bb#section",
    "http://news.example.test/article",
    "https://news.example.test:8443/article",
    "https://news.example.test/tutorial/localhost?search=localhost&offer=100%25",
    "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fnews.example.test%2Fa%3Fsig%3Dx%252By&data=signed%2Bdata&sdata=a%2Bb&reserved=0",
  ])("preserves the actual upstream URL and signed query: %s", (url) => {
    expect(externalWebLink(url, source)).toBe(url);
  });
  it.each([
    "javascript:alert(1)",
    "data:text/html,hello",
    "file:///C:/secret",
    "app://settings",
    "mailto:user@example.test",
    "//news.example.test",
    "https://user:secret@news.example.test/",
    "https://user@news.example.test/",
    "https://news.example.test:0/",
    "https://news.example.test\\@mail.example.test/",
    " https://news.example.test/",
    "https://news.example.test/\nsecret",
    "http://localhost:43123/owa/",
    "http://p0123456789abcdef0123456789abcdef.localhost:43123/owa/",
    "http://127.1/",
    "http://2130706433/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://localhost.:43123/",
    "https://news.example.test/?next=%2F%2F127.1%2F",
    "https://news.example.test/__sortofremoteng_public_navigation_v1?destination=x",
    "https://news.example.test/?__sorng_navigation_v1=secret",
    "https://news.example.test/?%5f%5fsorng_generation_v1=secret",
    "https://news.example.test/#__sorng_popup_parent_v1=4",
    "https://news.example.test/?next=https%3A%2F%2Flocalhost%3A43123%2F",
    "https://news.example.test/?next=%255f%255fsorng_generation_v1%3Dsecret",
    "https://mail.example.test/owa/?ae=Item&id=message",
    "https://mail.example.test/owa/#inbox",
    "not a url",
    null,
    "https://news.example.test/" + "a".repeat(16_384),
  ])(
    "rejects unsafe, local, internal, or credential-bearing URLs: %s",
    (url) => {
      expect(externalWebLink(url, source)).toBeNull();
    },
  );
});
