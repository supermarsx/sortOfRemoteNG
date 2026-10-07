import { describe, expect, it } from "vitest";
import {
  RD_WEB_LOGIN_SELECTORS,
  RD_WEB_PROFILE,
} from "../../src/utils/connection/rdWebProfile";
import { getHttpApplicationLoginModes } from "../../src/utils/connection/httpApplicationProfiles";
import { normalizeHttpApplicationSelectors } from "../../src/utils/auth/httpApplicationLogin";

describe("classic RD Web Access profile contract", () => {
  it("retains the saved ID and neutral locale landing with explicit opt-in", () => {
    expect(RD_WEB_PROFILE).toMatchObject({
      id: "rdweb",
      capability: "known-form",
      requiresHttps: true,
      loginPath: "/RDWeb/",
      selectors: RD_WEB_LOGIN_SELECTORS,
    });
    expect(getHttpApplicationLoginModes(RD_WEB_PROFILE)).toEqual([
      "manual",
      "form",
    ]);
    expect(RD_WEB_PROFILE.hostedLoginUrl).toBeUndefined();
    expect(RD_WEB_PROFILE.loginFlow).toBeUndefined();
    expect(RD_WEB_PROFILE.totpChallenges).toBeUndefined();
  });

  it("keeps all strict selectors within the frontend/backend transport limit", () => {
    expect(normalizeHttpApplicationSelectors(RD_WEB_LOGIN_SELECTORS)).toEqual(
      RD_WEB_LOGIN_SELECTORS,
    );
    for (const selector of Object.values(RD_WEB_LOGIN_SELECTORS)) {
      expect(selector.length).toBeLessThanOrEqual(512);
      expect(() => document.querySelector(selector)).not.toThrow();
      expect(selector).toContain('form#FrmLogin[name="FrmLogin"]');
    }
  });

  it("explains complete account formats and limits rather than promising a RemoteApp launch", () => {
    expect(RD_WEB_PROFILE.usernameLabel).toBe("Domain\\username or UPN");
    expect(RD_WEB_PROFILE.description).toContain(
      "no domain is guessed or added",
    );
    expect(RD_WEB_PROFILE.description).toContain("HTML5");
    expect(RD_WEB_PROFILE.description).toContain("MFA");
    expect(RD_WEB_PROFILE.description).toContain(
      "does not automatically launch",
    );
  });
});
