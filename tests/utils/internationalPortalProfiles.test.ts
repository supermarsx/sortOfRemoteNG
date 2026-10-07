import { describe, expect, it } from "vitest";
import { INTERNATIONAL_PORTAL_PROFILES } from "../../src/utils/connection/internationalPortalProfiles";

// Independently recorded public-entry contract, not successful-login evidence.
// Tests consume this lane's export without waiting for central registry wiring.
const expectedHostedEntries = [
  ["apple-account", "https://account.apple.com/", "custom"],
  ["apple-developer", "https://developer.apple.com/account/", "business"],
  [
    "register-com",
    "https://www.networksolutions.com/my-account/login",
    "networking",
  ],
  ["no-ip", "https://www.noip.com/login", "networking"],
  ["microsoft-account", "https://account.microsoft.com/", "custom"],
  ["microsoft-developer", "https://developer.microsoft.com/en-us/", "business"],
  ["hpe-support", "https://support.hpe.com/connect/login", "management"],
  ["notion", "https://app.notion.com/login", "business"],
  ["arlo", "https://my.arlo.com/", "monitoring"],
  ["steam", "https://store.steampowered.com/login/", "custom"],
  ["autodesk", "https://manage.autodesk.com/", "business"],
  ["kimi", "https://www.kimi.com/", "business"],
  ["lovable", "https://lovable.dev/login", "business"],
  ["npm", "https://www.npmjs.com/login", "business"],
  ["pypi", "https://pypi.org/account/login/", "business"],
  ["reddit", "https://www.reddit.com/login/", "custom"],
  ["tesla", "https://www.tesla.com/teslaaccount", "custom"],
  ["ebay", "https://signin.ebay.com/signin/", "custom"],
  ["x", "https://x.com/login", "custom"],
] as const;

const expectedTenantEntries = [
  ["zulip", "/login/", "business"],
  ["uptime-kuma", "/dashboard", "monitoring"],
  ["wazuh", "/", "monitoring"],
  ["zabbix", undefined, "monitoring"],
] as const;

describe("international portal profile contract", () => {
  it("accounts for all 23 requested services exactly once", () => {
    const ids = INTERNATIONAL_PORTAL_PROFILES.map(({ id }) => id);
    expect(INTERNATIONAL_PORTAL_PROFILES).toHaveLength(23);
    expect(new Set(ids).size).toBe(23);
    expect([...ids].sort()).toEqual(
      [...expectedHostedEntries, ...expectedTenantEntries]
        .map(([id]) => id)
        .sort(),
    );
  });

  it.each(expectedHostedEntries)(
    "%s uses its reviewed public entry and category",
    (id, hostedLoginUrl, category) => {
      const profile = INTERNATIONAL_PORTAL_PROFILES.find((p) => p.id === id);
      expect(profile).toMatchObject({ hostedLoginUrl, category });
      expect(profile?.loginPath).toBeUndefined();

      const url = new URL(profile!.hostedLoginUrl!);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).not.toMatch(/[*{}<>]/);
      expect(url.username).toBe("");
      expect(url.password).toBe("");
      expect(url.port).toBe("");
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
    },
  );

  it.each(expectedTenantEntries)(
    "%s keeps its host configurable and its route on the saved origin",
    (id, loginPath, category) => {
      const profile = INTERNATIONAL_PORTAL_PROFILES.find((p) => p.id === id);
      expect(profile).toMatchObject({ category });
      expect(profile?.loginPath).toBe(loginPath);
      expect(profile).not.toHaveProperty("hostedLoginUrl");
      expect(profile?.description).toMatch(/configure.*host/i);
      expect(profile?.label).toContain("self-hosted");

      // Zabbix has no universal installation path: the saved frontend URL wins.
      if (loginPath === undefined) {
        expect(profile).not.toHaveProperty("loginPath");
        expect(profile?.description).toContain("complete frontend URL");
        expect(profile?.description).toContain(
          "/zabbix for Apache or / for Nginx",
        );
        return;
      }

      // Reserved test names exercise arbitrary installations and custom ports.
      for (const origin of [
        "https://team.example.test",
        "https://internal.example.test:8443",
      ]) {
        const target = new URL(profile!.loginPath!, origin);
        expect(target.origin).toBe(origin);
        expect(target.pathname).toBe(loginPath);
        expect(target.search).toBe("");
        expect(target.hash).toBe("");
      }
    },
  );

  it.each(INTERNATIONAL_PORTAL_PROFILES)(
    "$id offers only manual HTTPS sign-in with no credential automation",
    (profile) => {
      expect(profile.capability).toBe("manual");
      expect(profile.requiresHttps).toBe(true);
      expect(profile.loginModes).toEqual(["manual"]);
      expect(profile).not.toHaveProperty("selectors");
      expect(profile).not.toHaveProperty("totpChallenges");
      expect(profile).not.toHaveProperty("loginFlow");
      expect(profile).not.toHaveProperty("emailOnly");
      expect(profile.description).toContain("Manual sign-in only");
      expect(profile.description).toContain("not been live-verified");
    },
  );

  it("exports only catalog metadata, never network or permission overrides", () => {
    const allowedKeys = new Set([
      "id",
      "label",
      "category",
      "capability",
      "requiresHttps",
      "loginModes",
      "hostedLoginUrl",
      "loginPath",
      "description",
    ]);
    for (const profile of INTERNATIONAL_PORTAL_PROFILES) {
      expect(
        Object.keys(profile).filter((key) => !allowedKeys.has(key)),
      ).toEqual([]);
    }
  });

  it("names overlapping brands without pretending they are new auth services", () => {
    const profile = (id: string) =>
      INTERNATIONAL_PORTAL_PROFILES.find((entry) => entry.id === id)!;
    expect(profile("register-com").description).toContain(
      "shares the existing Network Solutions destination",
    );
    expect(profile("apple-account").description).toContain("iCloud");
    expect(profile("hpe-support").description).toContain("GreenLake");
    expect(profile("npm").description).toContain("Nginx Proxy Manager");
    expect(profile("microsoft-developer").description).toContain(
      "public developer hub",
    );
    expect(profile("uptime-kuma").description).toContain("not a public status");
  });
});
