import { describe, expect, it } from "vitest";
import { HOSTED_DASHBOARD_PROFILES } from "../../src/utils/connection/hostedDashboardProfiles";
import {
  HTTP_APPLICATION_PROFILES,
  getHttpApplicationLoginModes,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import { HOSTED_DASHBOARD_ICON_SUGGESTIONS } from "../../src/utils/icons/hostedDashboardIconSuggestions";
import type { Connection } from "../../src/types/connection/connection";

const ids = [
  "namecheap",
  "network-solutions",
  "time4vps",
  "contabo",
  "chatgpt",
  "claude",
  "openrouter",
  "gitlab-com",
  "gitlab-self-hosted",
  "google-account",
  "google-cloud-console",
  "google-analytics",
  "google-business-profile",
  "google-search-console",
  "google-ads",
  "facebook",
  "instagram",
  "hpe-greenlake",
  "adobe",
  "youtube",
  "zoom",
  "icloud",
  "ovhcloud",
  "ptisp",
  "marcaria",
  "freedns",
  "registro-br",
  "sqlpad",
  "eaton-ups",
  "gmail",
  "outlook-online",
  "exchange-owa",
  "ddwrt",
  "freshtomato",
];
const connection = (
  id: string,
  loginMode: "manual" | "form" | "basic" | "digest" = "manual",
): Partial<Connection> => ({
  protocol: "https",
  hostname: "fixture.test",
  port: 443,
  authType: "basic",
  username: "fixture-account",
  password: "fixture-password",
  httpAutoLogin: true,
  httpHeaders: { Authorization: "Bearer fixture-not-for-website" },
  httpApplication: { version: 1, id, loginMode },
});

describe("source-reviewed dashboard presets", () => {
  it("registers exactly the requested distinct providers without duplicating Gitea", () => {
    expect(HOSTED_DASHBOARD_PROFILES.map((p) => p.id)).toEqual(ids);
    expect(
      HTTP_APPLICATION_PROFILES.filter((p) => p.id === "gitea"),
    ).toHaveLength(1);
    expect(new Set(HTTP_APPLICATION_PROFILES.map((p) => p.id)).size).toBe(
      HTTP_APPLICATION_PROFILES.length,
    );
    expect(Object.keys(HOSTED_DASHBOARD_ICON_SUGGESTIONS)).toEqual(ids);
    for (const p of HOSTED_DASHBOARD_PROFILES) {
      expect(getHttpApplicationProfile(p.id)).toBe(p);
      expect(normalizeHttpApplicationSettings({ id: p.id })).toMatchObject({
        id: p.id,
        loginMode: "manual",
      });
      expect(getHttpApplicationIconSuggestion(connection(p.id))?.icon.key).toBe(
        HOSTED_DASHBOARD_ICON_SUGGESTIONS[
          p.id as keyof typeof HOSTED_DASHBOARD_ICON_SUGGESTIONS
        ],
      );
    }
  });

  it.each(HOSTED_DASHBOARD_PROFILES.filter((p) => p.hostedLoginUrl))(
    "$id pins its HTTPS host, keeps credentials inert and does not invent MFA selectors",
    (p) => {
      const url = new URL(p.hostedLoginUrl!);
      expect(url.protocol).toBe("https:");
      expect(url.username + url.password + url.search + url.hash).toBe("");
      expect(p.capability).toBe("manual");
      expect(p.requiresHttps).toBe(true);
      expect(p.selectors).toBeUndefined();
      expect(p.totpChallenges).toBeUndefined();
      expect(getHttpApplicationLoginModes(p)).toEqual(["manual"]);
      expect(resolveHttpApplicationLogin(connection(p.id))).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
      expect(() =>
        resolveHttpApplicationLogin(connection(p.id, "form")),
      ).toThrow(/invalid|unavailable/);
      expect(() =>
        validateHttpApplicationTarget(connection(p.id), url.href),
      ).not.toThrow();
      for (const unsafe of [
        url.href.replace("https:", "http:"),
        `https://wrong.test${url.pathname}`,
        `https://${url.hostname}.attacker.test${url.pathname}`,
        `https://${url.hostname}:8443${url.pathname}`,
        `https://user:secret@${url.hostname}${url.pathname}`,
      ]) {
        expect(() =>
          validateHttpApplicationTarget(connection(p.id), unsafe),
        ).toThrow(/requires HTTPS/);
      }
      expect(p.description).toMatch(/system browser/);
    },
  );

  it("keeps mail, local GitLab and device targets separate from public account hosts", () => {
    for (const id of [
      "gitlab-self-hosted",
      "sqlpad",
      "eaton-ups",
      "exchange-owa",
    ]) {
      const p = getHttpApplicationProfile(id)!;
      expect(p.hostedLoginUrl).toBeUndefined();
      expect(() =>
        validateHttpApplicationTarget(
          connection(id),
          "https://internal.test:9443/",
        ),
      ).not.toThrow();
      expect(() =>
        validateHttpApplicationTarget(connection(id), "http://internal.test/"),
      ).toThrow(/HTTPS/);
    }
    expect(getHttpApplicationProfile("exchange-owa")?.loginPath).toBe("/owa/");
    expect(getHttpApplicationProfile("outlook-online")?.hostedLoginUrl).toBe(
      "https://outlook.office.com/mail/",
    );
    expect(getHttpApplicationProfile("gitlab-com")?.capability).toBe("manual");
  });

  it.each(["ddwrt", "freshtomato"])(
    "%s offers only explicit Basic or manual, never form/Digest inference",
    (id) => {
      expect(
        getHttpApplicationLoginModes(getHttpApplicationProfile(id)!),
      ).toEqual(["manual", "basic"]);
      expect(resolveHttpApplicationLogin(connection(id))).toMatchObject({
        autoLogin: false,
        credentials: null,
      });
      expect(resolveHttpApplicationLogin(connection(id, "basic"))).toEqual({
        credentials: {
          username: "fixture-account",
          password: "fixture-password",
        },
        autoLogin: false,
        upstreamAuthMode: "basic",
      });
      expect(() =>
        resolveHttpApplicationLogin(connection(id, "digest")),
      ).toThrow();
      expect(() =>
        resolveHttpApplicationLogin(connection(id, "form")),
      ).toThrow();
    },
  );

  it.each(["gitlab-self-hosted", "sqlpad"])(
    "%s resolves exact reviewed form controls with no HTTP Authorization",
    (id) => {
      expect(
        getHttpApplicationLoginModes(getHttpApplicationProfile(id)!),
      ).toEqual(["manual", "form"]);
      expect(resolveHttpApplicationLogin(connection(id, "form"))).toMatchObject(
        {
          autoLogin: true,
          upstreamAuthMode: "none",
          selectors: getHttpApplicationProfile(id)!.selectors,
        },
      );
    },
  );
});
