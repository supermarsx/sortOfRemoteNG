import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import {
  LINKEDIN_PROFILE,
  LINKEDIN_LOGIN_SELECTORS,
} from "../../src/utils/connection/linkedinProfile";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import { CONNECTION_ICON_CATALOG } from "../../src/utils/icons/connectionIconCatalog";

const saved: Partial<Connection> = {
  protocol: "https",
  hostname: "www.linkedin.com",
  port: 443,
  username: "fixture@example.test",
  password: "fixture-secret",
  httpApplication: { version: 1, id: "linkedin", loginMode: "form" },
};
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};
describe("LinkedIn application and icon", () => {
  it("registers exact HTTPS login, manual default and no automatic challenges", () => {
    expect(getHttpApplicationProfile("linkedin")).toBe(LINKEDIN_PROFILE);
    expect(LINKEDIN_PROFILE).toMatchObject({
      hostedLoginUrl: "https://www.linkedin.com/login",
      requiresHttps: true,
      capability: "known-form",
      loginModes: ["manual", "form"],
    });
    expect(LINKEDIN_PROFILE.totpChallenges).toBeUndefined();
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "linkedin" })
        ?.loginMode,
    ).toBe("manual");
  });
  it("provides a catalogued local theme-aware brand icon and suggestion", () => {
    const suggested = getHttpApplicationIconSuggestion(saved)!;
    expect(suggested.icon.key).toBe("linkedin");
    expect(
      CONNECTION_ICON_CATALOG.filter((icon) => icon.key === "linkedin"),
    ).toHaveLength(1);
    const Icon = suggested.icon.icon;
    const markup = renderToStaticMarkup(<Icon aria-label="LinkedIn" />);
    expect(markup).toContain("<svg");
    expect(markup).toContain('fill="currentColor"');
    expect(markup).not.toMatch(/<image|<script|(?:href|src)=|#[0-9a-f]{6}/i);
  });
  it.each(["", "custom.test"])(
    "selects without enabling credentials or overwriting custom host %s",
    (hostname) => {
      function Fixture() {
        const [formData, setFormData] = React.useState<Partial<Connection>>({
          ...saved,
          hostname,
          protocol: "http",
          port: 8443,
          httpVerifySsl: false,
          httpApplication: {
            version: 1,
            id: "generic-form",
            loginMode: "form",
          },
          httpAutoLogin: true,
          httpAutoLoginSelectors: { passwordSelector: "#old" },
          httpAutoMfa: { version: 1, enabled: true },
        });
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
      render(<Fixture />);
      const value = () =>
        JSON.parse(
          screen.getByTestId("value").textContent!,
        ) as Partial<Connection>;
      choose("Website application", "LinkedIn");
      expect(value()).toMatchObject({
        hostname: hostname || "www.linkedin.com",
        protocol: hostname ? "http" : "https",
        port: hostname ? 8443 : 443,
        username: saved.username,
        password: saved.password,
        httpVerifySsl: false,
        httpApplication: { version: 1, id: "linkedin", loginMode: "manual" },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(value().httpAutoLoginSelectors).toBeUndefined();
      expect(resolveHttpApplicationLogin(value()).credentials).toBeNull();
      fireEvent.click(
        screen.getByRole("button", { name: "Use LinkedIn login address" }),
      );
      expect(value()).toMatchObject({
        hostname: "www.linkedin.com",
        protocol: "https",
        port: 443,
        httpVerifySsl: false,
      });
      choose(
        "Application login mode",
        "Automatic form login — explicitly opt in",
      );
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: { username: saved.username, password: saved.password },
        autoLogin: true,
        upstreamAuthMode: "none",
        selectors: LINKEDIN_LOGIN_SELECTORS,
      });
    },
  );
  it("resolves database-vault secrets only when provided and never uses Basic fallback", () => {
    const vault = {
      ...saved,
      authType: "basic" as const,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(vault).credentials).toBeNull();
    const credentials = { username: "vault-user", password: "vault-fixture" };
    expect(resolveHttpApplicationLogin(vault, credentials)).toEqual({
      credentials,
      upstreamAuthMode: "none",
      autoLogin: true,
      selectors: LINKEDIN_LOGIN_SELECTORS,
    });
  });
  it.each([
    "http://www.linkedin.com/login",
    "https://linkedin.com/login",
    "https://www.linkedin.com:8443/login",
    "https://www.linkedin.com.evil.test/login",
    "https://user:pass@www.linkedin.com/login",
  ])("refuses origin %s", (url) => {
    expect(() => validateHttpApplicationTarget(saved, url)).toThrow(
      /requires HTTPS at www.linkedin.com/,
    );
  });
  it("accepts the canonical origin", () => {
    expect(() =>
      validateHttpApplicationTarget(saved, LINKEDIN_PROFILE.hostedLoginUrl!),
    ).not.toThrow();
  });
  it.each(["basic", "digest"] as const)(
    "rejects imported %s mode",
    (loginMode) => {
      expect(() =>
        resolveHttpApplicationLogin({
          ...saved,
          httpApplication: { ...saved.httpApplication!, loginMode },
        }),
      ).toThrow(/invalid/i);
    },
  );
  it("does not let selector overrides downgrade to generic login or automate MFA", () => {
    expect(() =>
      resolveHttpApplicationLogin({
        ...saved,
        httpAutoLoginSelectors: { submitSelector: "button" },
      }),
    ).toThrow(/reviewed controls/);
    expect(() =>
      resolveHttpApplicationLogin({
        ...saved,
        httpAutoMfa: { version: 1, enabled: true },
      }),
    ).toThrow(/interactive verification/);
  });
});
