import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureSynologyApiRoute } from "../../src/hooks/synology/synologyApiRoute";
const h = vi.hoisted(() => ({
  selected: undefined as string | undefined,
  invalid: false,
}));
vi.mock("../../src/hooks/integration/httpProxy", () => ({
  getGlobalHttpProxyUrl: (options: { failClosed?: boolean }) => {
    expect(options.failClosed).toBe(true);
    if (h.invalid) throw new Error("Invalid selected global route");
    return h.selected;
  },
}));
beforeEach(() => {
  h.selected = undefined;
  h.invalid = false;
});
describe("explicit native Synology API route capture", () => {
  it("captures explicit direct only when the existing browser helper selects no proxy", () => {
    const snapshot = captureSynologyApiRoute();
    expect(snapshot.route).toEqual({ kind: "direct" });
    h.invalid = true;
    expect(snapshot.assertCurrent).toThrow(/changed/);
    expect(captureSynologyApiRoute).toThrow();
  });
  it.each(["http", "https"])(
    "splits %s proxy authentication from its canonical origin without saving route fields",
    (scheme) => {
      h.selected = `${scheme}://user%40fixture:private%3Apass%25@proxy.test:8443`;
      const snapshot = captureSynologyApiRoute();
      expect(snapshot.route).toEqual({
        kind: "http_proxy",
        url: `${scheme}://proxy.test:8443`,
        username: "user@fixture",
        password: "private:pass%",
      });
      expect(Object.isFrozen(snapshot.route)).toBe(true);
      expect(snapshot.assertCurrent).not.toThrow();
      h.selected = `${scheme}://user%40fixture:changed@proxy.test:8443`;
      expect(snapshot.assertCurrent).toThrow(/changed/);
    },
  );
  it.each([
    "socks5://proxy.test:1080",
    "http://proxy.test/path",
    "http://proxy.test/?token=x",
    "http://proxy.test/#x",
    "http://proxy.test:0",
    "http://:private@proxy.test:8080",
    "http://user:%00@proxy.test:8080",
    `http://user:${"x".repeat(4097)}@proxy.test:8080`,
  ])(
    "refuses unsupported or malformed proxy input without echoing it",
    (selected) => {
      h.selected = selected;
      expect(captureSynologyApiRoute).toThrow(
        "The selected global proxy is not a supported HTTP(S) route.",
      );
      try {
        captureSynologyApiRoute();
      } catch (error) {
        expect(String(error)).not.toContain(selected);
      }
    },
  );
});
