import { describe, expect, it } from "vitest";
import {
  OPNSENSE_LOGIN_SELECTORS,
  OPNSENSE_PROFILE,
} from "../../src/utils/connection/opnsenseProfile";
import { getHttpApplicationLoginModes } from "../../src/utils/connection/httpApplicationProfiles";
import { normalizeHttpApplicationSelectors } from "../../src/utils/auth/httpApplicationLogin";

describe("OPNsense WebGUI profile", () => {
  it("offers opt-in form login without a vendor cloud destination", () => {
    expect(OPNSENSE_PROFILE).toMatchObject({
      id: "opnsense",
      label: "OPNsense",
      category: "networking",
      capability: "known-form",
      requiresHttps: true,
      loginPath: "/",
      selectors: OPNSENSE_LOGIN_SELECTORS,
    });
    expect(getHttpApplicationLoginModes(OPNSENSE_PROFILE)).toEqual([
      "manual",
      "form",
    ]);
    expect(OPNSENSE_PROFILE.hostedLoginUrl).toBeUndefined();
    expect(OPNSENSE_PROFILE.loginFlow).toBeUndefined();
    expect(OPNSENSE_PROFILE.totpChallenges).toBeUndefined();
  });

  it("uses the OPNsense button rather than the pfSense input submitter", () => {
    expect(OPNSENSE_LOGIN_SELECTORS.submitSelector).toContain(
      'button[type="submit"][name="login"][value="1"]',
    );
    expect(OPNSENSE_LOGIN_SELECTORS.submitSelector).not.toContain(
      'input[type="submit"]',
    );
  });

  it("keeps strict, transport-safe selectors scoped to the reviewed POST form", () => {
    expect(normalizeHttpApplicationSelectors(OPNSENSE_LOGIN_SELECTORS)).toEqual(
      OPNSENSE_LOGIN_SELECTORS,
    );
    for (const selector of Object.values(OPNSENSE_LOGIN_SELECTORS)) {
      expect(selector.length).toBeLessThanOrEqual(512);
      expect(() => document.querySelector(selector)).not.toThrow();
      expect(selector).toContain('form#iform[name="iform"][method="post" i]');
      expect(selector).toContain("body.page-login");
      expect(selector).toContain(":enabled");
    }
  });

  it("states password-only limits and does not claim a live authenticated check", () => {
    expect(OPNSENSE_PROFILE.description).toContain(
      "Manual login is the default",
    );
    expect(OPNSENSE_PROFILE.description).toContain("explicit opt-in");
    expect(OPNSENSE_PROFILE.description).toContain("TOTP");
    expect(OPNSENSE_PROFILE.description).toContain("SSO");
    expect(OPNSENSE_PROFILE.description).toContain("Captive portal");
    expect(OPNSENSE_PROFILE.description).toContain(
      "Live authenticated login has not been verified",
    );
  });
});
