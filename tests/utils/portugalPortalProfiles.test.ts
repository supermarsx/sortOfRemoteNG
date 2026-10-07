import { describe, expect, it } from "vitest";
import { PORTUGAL_PORTAL_PROFILES } from "../../src/utils/connection/portugalPortalProfiles";

// Keep this suite independent of the shared registry: its owner integrates the
// exported array separately. Expected URLs pin the reviewed public destinations.
const reviewedEntries = {
  "cegid-primavera": "https://mycegid.ila.cegid.com/pt/",
  "autoridade-tributaria":
    "https://www.portaldasfinancas.gov.pt/at/html/index.html",
  "seguranca-social-direta": "https://www.seg-social.pt/ptss/",
  "irn-online": "https://registo.justica.gov.pt/Login",
  "e-redes": "https://balcaodigital.e-redes.pt/home",
  "meo-particulares": "https://my.meo.pt/",
  "meo-empresas":
    "https://cliente-empresas.meo.pt/Pages/Dashboard/Dashboard.aspx",
  "vodafone-portugal": "https://my.vodafone.pt/",
  "digi-portugal": "https://mydigi.digi.pt/",
  "imt-online": "https://servicos.imt-ip.pt/login.aspx",
  "via-verde": "https://www.viaverde.pt/particulares/login",
  "uzo-particulares": "https://my.uzo.pt/",
} as const;

describe("Portuguese portal profiles before registry integration", () => {
  it("covers every verified service once and omits an unverified UZO business preset", () => {
    const ids = PORTUGAL_PORTAL_PROFILES.map(({ id }) => id);
    expect(ids.sort()).toEqual(Object.keys(reviewedEntries).sort());
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      PORTUGAL_PORTAL_PROFILES.filter(({ id }) => id.startsWith("uzo-")),
    ).toHaveLength(1);
  });

  it.each(PORTUGAL_PORTAL_PROFILES)(
    "$id exposes manual sign-in only, without credential or challenge automation",
    (profile) => {
      expect(profile).toMatchObject({
        capability: "manual",
        loginModes: ["manual"],
        requiresHttps: true,
        category: "business",
      });
      expect(profile.selectors).toBeUndefined();
      expect(profile.totpChallenges).toBeUndefined();
      expect(profile.loginFlow).toBeUndefined();
      expect(profile.emailOnly).toBeUndefined();
      expect(profile.usernameLabel).toBeUndefined();
      expect(profile.loginPath).toBeUndefined();
      expect(profile.description).toContain("apenas manual");
      expect(profile.description).toContain(
        "não são preenchidos automaticamente",
      );
    },
  );

  it.each(Object.entries(reviewedEntries))(
    "%s keeps its reviewed HTTPS entry without captured identity-provider state",
    (id, expectedUrl) => {
      const profile = PORTUGAL_PORTAL_PROFILES.find((entry) => entry.id === id);
      expect(profile?.hostedLoginUrl).toBe(expectedUrl);
      const target = new URL(profile!.hostedLoginUrl!);
      expect(target.protocol).toBe("https:");
      expect(target.port).toBe("");
      expect(target.username).toBe("");
      expect(target.password).toBe("");
      expect(target.search).toBe("");
      expect(target.hash).toBe("");
      expect(target.hostname).not.toMatch(/\*|localhost|example|invalid/);
    },
  );

  it("keeps MEO consumer and business services on their separate published portals", () => {
    const consumer = PORTUGAL_PORTAL_PROFILES.find(
      ({ id }) => id === "meo-particulares",
    )!;
    const business = PORTUGAL_PORTAL_PROFILES.find(
      ({ id }) => id === "meo-empresas",
    )!;
    expect(consumer.label).toContain("Particulares");
    expect(business.label).toContain("Empresas");
    expect(new URL(consumer.hostedLoginUrl!).origin).not.toBe(
      new URL(business.hostedLoginUrl!).origin,
    );
  });
});
