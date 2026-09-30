import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  PORKBUN_LOGIN_SELECTORS,
  PORKBUN_LOGIN_URL,
  PORKBUN_TOTP_CHALLENGE,
} from "../../src/utils/connection/porkbunProfile";
import {
  resolveHttpApplicationLogin,
  getReviewedApplicationProfile,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";

const saved: Partial<Connection> = {
  protocol: "https",
  hostname: "porkbun.com",
  port: 443,
  username: "fixture-user",
  password: "fixture-password",
  httpApplication: { version: 1, id: "porkbun", loginMode: "form" },
};

describe("Porkbun registrar application", () => {
  it("selects the exact HTTPS address with manual login and clears stale automation consent", () => {
    const initial: Partial<Connection> = {
      ...saved,
      protocol: "http",
      hostname: "unrelated.example.test",
      port: 8080,
      icon: "server",
      httpVerifySsl: true,
      httpApplication: { version: 1, id: "generic-form", loginMode: "form" },
      httpAutoLogin: true,
      httpAutoLoginSelectors: { passwordSelector: "#unrelated" },
      httpAutoMfa: {
        version: 1,
        enabled: true,
        challengeId: "unrelated",
        totpConfigId: "other-authenticator",
        origin: "https://unrelated.example.test",
      },
    };
    function Fixture() {
      const [formData, setFormData] = React.useState(initial);
      return (
        <>
          <HTTPOptions
            formData={formData}
            setFormData={setFormData}
            sections={["application"]}
          />
          <output data-testid="value">{JSON.stringify(formData)}</output>
        </>
      );
    }
    const value = () =>
      JSON.parse(
        screen.getByTestId("value").textContent!,
      ) as Partial<Connection>;
    const choose = (label: string, option: string) => {
      fireEvent.click(screen.getByLabelText(label));
      fireEvent.mouseDown(screen.getByRole("option", { name: option }));
    };
    render(<Fixture />);
    choose("Website application", "Porkbun");
    expect(value()).toMatchObject({
      protocol: "https",
      hostname: "porkbun.com",
      port: 443,
      username: saved.username,
      password: saved.password,
      icon: "server",
      httpVerifySsl: true,
      httpApplication: { version: 1, id: "porkbun", loginMode: "manual" },
      httpAutoLogin: false,
      httpAutoMfa: { version: 1, enabled: false },
    });
    expect(value().httpAutoLoginSelectors).toBeUndefined();
    expect(screen.getByText(PORKBUN_LOGIN_URL)).toBeInTheDocument();
    expect(resolveHttpApplicationLogin(value())).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    choose(
      "Application login mode",
      "Automatic form login — explicitly opt in",
    );
    expect(resolveHttpApplicationLogin(value())).toMatchObject({
      autoLogin: true,
      upstreamAuthMode: "none",
      credentials: { username: saved.username, password: saved.password },
      selectors: PORKBUN_LOGIN_SELECTORS,
    });
    expect(value().httpAutoMfa?.enabled).toBe(false);
    expect(value().httpApplication).not.toHaveProperty("password");
  });

  it("uses the existing generic form and vault paths, with no transport authentication", () => {
    const connection = {
      ...saved,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(connection).credentials).toBeNull();
    const vault = { username: "vault-user", password: "vault-fixture" };
    expect(resolveHttpApplicationLogin(connection, vault)).toMatchObject({
      credentials: vault,
      upstreamAuthMode: "none",
      autoLogin: true,
      selectors: PORKBUN_LOGIN_SELECTORS,
    });
    expect(
      resolveHttpApplicationLogin(connection, vault).loginFlow,
    ).toBeUndefined();
    expect(connection.password).toBe(saved.password);
  });

  it("round-trips bounded metadata and only registers the reviewed app-code challenge", () => {
    const profile = getHttpApplicationProfile("porkbun")!;
    expect(profile.hostedLoginUrl).toBe(PORKBUN_LOGIN_URL);
    expect(profile.loginPath).toBe("/account/login");
    expect(profile.requiresHttps).toBe(true);
    expect(profile.totpChallenges).toEqual([PORKBUN_TOTP_CHALLENGE]);
    expect(profile.loginFlow).toBeUndefined();
    expect(getReviewedApplicationProfile(saved)).toBe("porkbun");
    expect(
      getReviewedApplicationProfile({
        ...saved,
        httpApplication: { ...saved.httpApplication!, invalid: true },
      }),
    ).toBeUndefined();
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "porkbun" }),
    ).toEqual({ version: 1, id: "porkbun", loginMode: "manual" });
    expect(
      normalizeHttpApplicationSettings(
        JSON.parse(JSON.stringify(saved.httpApplication)),
      ),
    ).toEqual(saved.httpApplication);
    expect(getHttpApplicationIconSuggestion(saved)?.icon.key).toBe("porkbun");
    expect(
      getHttpApplicationExternalTarget(
        saved,
        "https://porkbun.com/account/domains?private=value#fragment",
      ),
    ).toEqual({ label: "Porkbun", url: PORKBUN_LOGIN_URL });
  });

  it.each([
    "http://porkbun.com/account/login",
    "https://porkbun.com:444/account/login",
    "https://www.porkbun.com/account/login",
    "https://api.porkbun.com/account/login",
    "https://webmail.porkbun.com/account/login",
    "https://porkbun.com.attacker.test/account/login",
    "https://porkbun.com@attacker.test/account/login",
    "https://user@porkbun.com/account/login",
  ])("rejects a foreign or noncanonical target: %s", (target) => {
    expect(() => validateHttpApplicationTarget(saved, target)).toThrow(
      /requires HTTPS/,
    );
    expect(getHttpApplicationExternalTarget(saved, target)).toBeNull();
  });

  it.each([
    PORKBUN_LOGIN_URL,
    "https://porkbun.com:443/account/login",
    "https://porkbun.com/account/domains",
  ])("accepts the exact hosted origin: %s", (target) => {
    expect(() => validateHttpApplicationTarget(saved, target)).not.toThrow();
  });

  it.each(["basic", "digest"])("rejects imported %s mode", (loginMode) => {
    const httpApplication = {
      ...saved.httpApplication!,
      loginMode,
    } as Connection["httpApplication"];
    expect(normalizeHttpApplicationSettings(httpApplication)?.invalid).toBe(
      true,
    );
    expect(() =>
      resolveHttpApplicationLogin({ ...saved, httpApplication }),
    ).toThrow(/invalid/);
  });
});
