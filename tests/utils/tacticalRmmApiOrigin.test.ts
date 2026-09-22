import { describe, expect, it } from "vitest";
import {
  normalizeHttpApplicationSettings,
  normalizeTacticalRmmApiOrigin,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  getReviewedApplicationApiOrigin,
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
} from "../../src/utils/auth/httpApplicationLogin";
import type { HttpApplicationSettings } from "../../src/types/connection/connection";

const tactical = {
  version: 1,
  id: "tacticalrmm",
  loginMode: "manual",
} as const;

describe("Tactical RMM exact API origin", () => {
  it.each([
    [
      "https://api.rmm.apps.vogue-homes.com",
      "https://api.rmm.apps.vogue-homes.com",
    ],
    ["HTTPS://API.example.com:443/", "https://api.example.com"],
    ["https://backend.example.net/", "https://backend.example.net"],
    ["https://[2001:db8::1]:443/", "https://[2001:db8::1]"],
  ])(
    "canonicalizes %s without deriving another host",
    (apiOrigin, expected) => {
      const input = { ...tactical, apiOrigin };
      const normalized = normalizeHttpApplicationSettings(input);
      expect(normalizeTacticalRmmApiOrigin(apiOrigin)).toBe(expected);
      expect(normalized).toEqual({ ...tactical, apiOrigin: expected });
      expect(normalizeHttpApplicationSettings(normalized)).toEqual(normalized);
      expect(getReviewedApplicationApiOrigin({ httpApplication: input })).toBe(
        expected,
      );
      expect(getReviewedApplicationProfile({ httpApplication: input })).toBe(
        "tacticalrmm",
      );
      expect(input.apiOrigin).toBe(apiOrigin);
    },
  );

  it.each([
    "",
    " ",
    null,
    42,
    true,
    {},
    [],
    "http://api.example.com",
    "//api.example.com",
    "https:api.example.com",
    "https:///api.example.com",
    "https://api.example.com:8443",
    "https://api.example.com:0",
    "https://user:secret@api.example.com",
    "https://user@api.example.com",
    "https://@api.example.com",
    "https://api.example.com/api/",
    "https://api.example.com/.",
    "https://api.example.com/%2e",
    "https://api.example.com//",
    "https://api.example.com?secret=x",
    "https://api.example.com?",
    "https://api.example.com#fragment",
    "https://api.example.com#",
    " https://api.example.com",
    "https://api.example.com\n",
    "https://api.\texample.com",
    "https://api.example.com\\",
    "https://%61pi.example.com",
  ])("keeps malformed imported API origin %j invalid", (apiOrigin) => {
    const input = { ...tactical, apiOrigin } as HttpApplicationSettings;
    const normalized = normalizeHttpApplicationSettings(input);
    expect(normalizeTacticalRmmApiOrigin(apiOrigin)).toBeUndefined();
    expect(normalized).toEqual({ ...tactical, invalid: true });
    expect(normalizeHttpApplicationSettings(normalized)).toEqual(normalized);
    expect(
      getReviewedApplicationApiOrigin({ httpApplication: input }),
    ).toBeUndefined();
    expect(
      getReviewedApplicationProfile({ httpApplication: input }),
    ).toBeUndefined();
    expect(() =>
      resolveHttpApplicationLogin({ httpApplication: input }),
    ).toThrow(/invalid/);
  });

  it("omits an unset API origin and preserves the reviewed profile marker", () => {
    expect(normalizeHttpApplicationSettings(tactical)).toEqual(tactical);
    expect(
      getReviewedApplicationApiOrigin({ httpApplication: tactical }),
    ).toBeUndefined();
    expect(getReviewedApplicationProfile({ httpApplication: tactical })).toBe(
      "tacticalrmm",
    );
    expect(getReviewedApplicationApiOrigin(undefined)).toBeUndefined();
    expect(getReviewedApplicationApiOrigin(null)).toBeUndefined();
    expect(getReviewedApplicationApiOrigin({})).toBeUndefined();
  });

  it.each(["portainer", "joomla", "generic-form", "unknown"])(
    "refuses the Tactical-only field on %s",
    (id) => {
      const input = { ...tactical, id, apiOrigin: "https://api.example.com" };
      expect(normalizeHttpApplicationSettings(input)).toEqual({
        ...tactical,
        id,
        invalid: true,
      });
      expect(
        getReviewedApplicationApiOrigin({ httpApplication: input }),
      ).toBeUndefined();
    },
  );

  it.each([
    { ...tactical, invalid: true as const },
    { ...tactical, version: 2 },
    { ...tactical, loginMode: "unknown" },
  ])(
    "does not return an origin from an otherwise invalid profile %j",
    (profile) => {
      const httpApplication = {
        ...profile,
        apiOrigin: "https://api.example.com",
      } as HttpApplicationSettings;
      expect(
        getReviewedApplicationApiOrigin({ httpApplication }),
      ).toBeUndefined();
      expect(
        getReviewedApplicationProfile({ httpApplication }),
      ).toBeUndefined();
    },
  );
});
