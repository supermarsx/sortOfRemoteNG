import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import {
  INSTAGRAM_PROFILE,
  INSTAGRAM_LOGIN_SELECTORS,
} from "../../src/utils/connection/instagramProfile";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";

const saved: Partial<Connection> = {
  protocol: "https",
  hostname: "www.instagram.com",
  port: 443,
  username: "fixture-user",
  password: "fixture-password",
  httpApplication: { version: 1, id: "instagram", loginMode: "form" },
};
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};

describe("Instagram reviewed frontend profile", () => {
  it("keeps the stable id and built-in icon, manual default and exact form selectors", () => {
    expect(getHttpApplicationProfile("instagram")).toBe(INSTAGRAM_PROFILE);
    expect(INSTAGRAM_PROFILE).toMatchObject({
      hostedLoginUrl: "https://www.instagram.com/accounts/login/",
      requiresHttps: true,
      loginModes: ["manual", "form"],
      capability: "known-form",
    });
    expect(INSTAGRAM_LOGIN_SELECTORS).toEqual({
      usernameSelector: 'form input[name="username"]',
      passwordSelector: 'form input[name="password"][type="password"]',
      submitSelector: 'form button[type="submit"]',
    });
    expect(INSTAGRAM_PROFILE.loginFlow).toBeUndefined();
    expect(INSTAGRAM_PROFILE.totpChallenges).toBeUndefined();
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "instagram" })
        ?.loginMode,
    ).toBe("manual");
    expect(getReviewedApplicationProfile(saved)).toBe("instagram");
    expect(
      getReviewedApplicationProfile({
        ...saved,
        httpApplication: { ...saved.httpApplication!, invalid: true },
      }),
    ).toBeUndefined();
    expect(getHttpApplicationIconSuggestion(saved)?.icon.key).toBe("instagram");
  });
  it.each(["", "custom.example.test"])(
    "requires explicit consent and preserves custom address %s, TLS and credentials",
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
      choose("Website application", "Instagram");
      expect(value()).toMatchObject({
        hostname: hostname || "www.instagram.com",
        protocol: hostname ? "http" : "https",
        port: hostname ? 8443 : 443,
        username: saved.username,
        password: saved.password,
        httpVerifySsl: false,
        httpApplication: { version: 1, id: "instagram", loginMode: "manual" },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(value().httpAutoLoginSelectors).toBeUndefined();
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
      expect(
        screen.getByText(/Checkpoints, 2FA, recovery, CAPTCHA/),
      ).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Use Instagram login address" }),
      );
      expect(value()).toMatchObject({
        hostname: "www.instagram.com",
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
        selectors: INSTAGRAM_LOGIN_SELECTORS,
      });
    },
  );
  it("uses saved/vault credentials through the ordinary resolver, with no Basic fallback", () => {
    expect(
      resolveHttpApplicationLogin({ ...saved, authType: "basic" }),
    ).toEqual({
      credentials: { username: saved.username, password: saved.password },
      upstreamAuthMode: "none",
      autoLogin: true,
      selectors: INSTAGRAM_LOGIN_SELECTORS,
    });
    const vault = {
      ...saved,
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
      selectors: INSTAGRAM_LOGIN_SELECTORS,
    });
  });
  it.each([
    "http://www.instagram.com/accounts/login/",
    "https://instagram.com/",
    "https://www.instagram.com:8443/",
    "https://www.instagram.com.evil.test/",
    "https://user:pass@www.instagram.com/",
  ])("rejects noncanonical automatic origin %s", (url) => {
    expect(() => validateHttpApplicationTarget(saved, url)).toThrow(
      /requires HTTPS at www.instagram.com/,
    );
  });
  it("accepts the exact hosted origin", () => {
    expect(() =>
      validateHttpApplicationTarget(
        saved,
        "https://www.instagram.com/accounts/login/",
      ),
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
});
