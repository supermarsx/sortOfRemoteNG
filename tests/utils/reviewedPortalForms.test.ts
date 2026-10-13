import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import {
  acceptsHttpLoginSteps,
  getHttpApplicationLoginModes,
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";

// Hosted portals whose single sign-in form is typed into on the live path
// (catalog capability `known-form`), each tied to its evidence directory.
// Every selector the catalog uses must be one the evidence cites, with the
// same role; challenges after the form stay with the user.
const root = resolve(__dirname, "../..");
const REVIEWED_PORTAL_FORMS = {
  "vodafone-portugal": {
    hostedLoginUrl: "https://my.vodafone.pt/",
    fixturePath: "/main.html",
    submit: true,
  },
  freedns: {
    hostedLoginUrl: "https://freedns.afraid.org/",
    fixturePath: "/zc.php",
    // No source shows the sign-in button: the page client finds the form's
    // own submit control, so no submit selector is invented.
    submit: false,
  },
  "registro-br": {
    hostedLoginUrl: "https://registro.br/login/",
    fixturePath: "/login/",
    submit: true,
  },
} as const;
type Id = keyof typeof REVIEWED_PORTAL_FORMS;
const ids = Object.keys(REVIEWED_PORTAL_FORMS) as Id[];

interface EvidenceSelector {
  selector: string;
  role: string;
  basis: string;
}
interface Evidence {
  id: string;
  class: string;
  mechanism: string;
  selectors: EvidenceSelector[];
  fixtures: { file: string; path: string }[];
  staysInteractive: { kind: string }[];
}
const evidence = (id: Id): Evidence =>
  JSON.parse(
    readFileSync(
      join(root, "tests/fixtures/logins", id, "evidence.json"),
      "utf8",
    ),
  );
const stepsFiles = (id: Id) => {
  const dir = join(root, "src/data/loginSteps");
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name, `${id}.json`))
    .filter((file) => existsSync(file));
};
const fixture = (id: Id) => {
  const html = readFileSync(
    join(root, "tests/fixtures/logins", id, "fixture.html"),
    "utf8",
  );
  return new DOMParser().parseFromString(html, "text/html");
};

const connection = (
  id: Id,
  loginMode: "manual" | "form" | "basic" | "digest",
): Partial<Connection> => ({
  protocol: "https",
  hostname: new URL(REVIEWED_PORTAL_FORMS[id].hostedLoginUrl).hostname,
  port: 443,
  username: "fixture-account",
  password: "fixture-password",
  authType: "basic",
  httpAutoLogin: true,
  httpApplication: { version: 1, id, loginMode },
});

describe("hosted portals with a reviewed single sign-in form", () => {
  it.each(ids)(
    "%s types into its single form on the live path, opt-in only",
    (id) => {
      const profile = getHttpApplicationProfile(id)!;
      expect(profile).toMatchObject({
        id,
        capability: "known-form",
        requiresHttps: true,
        hostedLoginUrl: REVIEWED_PORTAL_FORMS[id].hostedLoginUrl,
      });
      expect(getHttpApplicationLoginModes(profile)).toEqual(["manual", "form"]);
      expect(profile.loginFlow).toBeUndefined();
      expect(profile.emailOnly).toBeUndefined();
      expect(profile.totpChallenges).toBeUndefined();
      expect(profile.loginPath).toBeUndefined();
      expect(profile.sameOriginLoginFrames).toBeUndefined();
      // A new connection still starts in manual mode.
      expect(normalizeHttpApplicationSettings({ version: 1, id })).toEqual({
        version: 1,
        id,
        loginMode: "manual",
      });
      expect(resolveHttpApplicationLogin(connection(id, "manual"))).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
      expect(resolveHttpApplicationLogin(connection(id, "form"))).toEqual({
        credentials: {
          username: "fixture-account",
          password: "fixture-password",
        },
        upstreamAuthMode: "none",
        autoLogin: true,
        selectors: profile.selectors,
      });
      for (const loginMode of ["basic", "digest"] as const)
        expect(() =>
          resolveHttpApplicationLogin(connection(id, loginMode)),
        ).toThrow(/invalid|unavailable/);
      const url = new URL(profile.hostedLoginUrl!);
      expect(() =>
        validateHttpApplicationTarget(connection(id, "form"), url.href),
      ).not.toThrow();
      for (const unsafe of [
        url.href.replace("https:", "http:"),
        `https://${url.hostname}.attacker.test${url.pathname}`,
        `https://${url.hostname}:8443${url.pathname}`,
      ])
        expect(() =>
          validateHttpApplicationTarget(connection(id, "form"), unsafe),
        ).toThrow();
    },
  );

  it.each(ids)(
    "%s uses only selectors its evidence cites, in the same role",
    (id) => {
      const profile = getHttpApplicationProfile(id)!;
      const cited = evidence(id);
      expect(cited).toMatchObject({ id, mechanism: "form" });
      expect(["A", "B"]).toContain(cited.class);
      const roleOf = (selector: string | undefined) =>
        cited.selectors.find((entry) => entry.selector === selector)?.role;
      const { usernameSelector, passwordSelector, submitSelector } =
        profile.selectors!;
      expect(roleOf(usernameSelector)).toBe("username");
      expect(roleOf(passwordSelector)).toBe("password");
      if (REVIEWED_PORTAL_FORMS[id].submit)
        expect(roleOf(submitSelector)).toBe("control");
      else expect(submitSelector).toBeUndefined();
      expect(Object.keys(profile.selectors!).sort()).toEqual(
        [
          "passwordSelector",
          "usernameSelector",
          ...(REVIEWED_PORTAL_FORMS[id].submit ? ["submitSelector"] : []),
        ].sort(),
      );
    },
  );

  it.each(ids)(
    "%s selectors find exactly one field each, in one form, in its fixture",
    (id) => {
      const { usernameSelector, passwordSelector, submitSelector } =
        getHttpApplicationProfile(id)!.selectors!;
      expect(
        evidence(id).fixtures.find(({ file }) => file === "fixture.html")?.path,
      ).toBe(REVIEWED_PORTAL_FORMS[id].fixturePath);
      const doc = fixture(id);
      const user = doc.querySelectorAll<HTMLInputElement>(usernameSelector!);
      const pw = doc.querySelectorAll<HTMLInputElement>(passwordSelector!);
      expect(user).toHaveLength(1);
      expect(pw).toHaveLength(1);
      expect(pw[0].type).toBe("password");
      expect(user[0].form).not.toBeNull();
      expect(user[0].form).toBe(pw[0].form);
      if (submitSelector) {
        const submit = doc.querySelectorAll<HTMLButtonElement>(submitSelector);
        expect(submit).toHaveLength(1);
        expect(submit[0].form).toBe(pw[0].form);
      }
    },
  );

  it.each(ids)(
    "%s has no steps file: a reviewed form is never replaced by steps",
    (id) => {
      expect(stepsFiles(id)).toEqual([]);
      expect(acceptsHttpLoginSteps(getHttpApplicationProfile(id)!)).toBe(false);
    },
  );

  it.each(ids)(
    "%s says what stays with the user and that the layout is unverified",
    (id) => {
      const { description } = getHttpApplicationProfile(id)!;
      expect(description).not.toMatch(
        /apenas manual|Interactive sign-in only|are not supplied|não são preenchidos/,
      );
      const kinds = evidence(id).staysInteractive.map(({ kind }) => kind);
      if (kinds.includes("captcha"))
        expect(description).toMatch(/CAPTCHA|reCAPTCHA|Turnstile/);
      if (kinds.includes("sms-code")) expect(description).toMatch(/SMS/);
      if (kinds.includes("totp"))
        expect(description).toMatch(/two-factor|2FA|autenticação/i);
      if (evidence(id).class === "B")
        expect(description).toMatch(/not been live-verified|não foi verificad/);
    },
  );
});
