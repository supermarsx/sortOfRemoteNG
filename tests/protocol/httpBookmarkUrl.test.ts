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
});
