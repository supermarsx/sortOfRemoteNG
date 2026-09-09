import { describe, expect, it } from "vitest";
import {
  classifySession,
  getProxySessionStatusMeta,
} from "../../src/components/network/internalProxySessionStatus";

describe("current proxy request health, not website authentication", () => {
  it.each(["HTTP 401 for /api/auth", "HTTP 500 for /api/status"])(
    "recovers from %s while preserving lifetime error totals",
    (last_error) => {
      const before = { request_count: 3, error_count: 1, last_error };
      expect(classifySession(before)).not.toBe("healthy");
      expect(
        classifySession({ ...before, request_count: 4, last_error: null }),
      ).toBe("healthy");
      expect(before.error_count).toBe(1);
    },
  );
  it("distinguishes request-level 401 from proxy-auth407 without declaring a site logged in", () => {
    expect(
      getProxySessionStatusMeta(
        classifySession({
          request_count: 2,
          error_count: 1,
          last_error: "HTTP 401",
        }),
      ).label,
    ).toBe("Request unauthorized");
    expect(
      getProxySessionStatusMeta(
        classifySession({
          request_count: 2,
          error_count: 1,
          last_error: "HTTP 407",
        }),
      ).label,
    ).toBe("Proxy authentication required");
    expect(
      classifySession({ request_count: 0, error_count: 0, last_error: null }),
    ).toBe("waiting");
    expect(getProxySessionStatusMeta("healthy").label).toBe("Healthy");
  });
});
