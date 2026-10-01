import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import { ADOBE_ADMIN_CONSOLE_PROFILE } from "../../src/utils/connection/adobeAdminConsoleProfile";
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
  hostname: "adminconsole.adobe.com",
  port: 443,
  username: "fixture@example.test",
  password: "fixture-only",
  httpApplication: { version: 1, id: "adobe-admin-console", loginMode: "form" },
};
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};

describe("Adobe Admin Console profile", () => {
  it("registers a distinct staged profile with manual default and the existing Adobe icon", () => {
    expect(getHttpApplicationProfile("adobe-admin-console")).toBe(
      ADOBE_ADMIN_CONSOLE_PROFILE,
    );
    expect(ADOBE_ADMIN_CONSOLE_PROFILE).toMatchObject({
      hostedLoginUrl: "https://adminconsole.adobe.com/",
      requiresHttps: true,
      loginModes: ["manual", "form"],
      loginFlow: "adobe",
      capability: "known-form",
    });
    expect(
      normalizeHttpApplicationSettings({
        version: 1,
        id: "adobe-admin-console",
      })?.loginMode,
    ).toBe("manual");
    expect(getReviewedApplicationProfile(saved)).toBe("adobe-admin-console");
    expect(
      getReviewedApplicationProfile({
        ...saved,
        httpApplication: { ...saved.httpApplication!, invalid: true },
      }),
    ).toBeUndefined();
    expect(getHttpApplicationIconSuggestion(saved)?.icon).toBe(
      getHttpApplicationIconSuggestion({
        ...saved,
        httpApplication: { version: 1, id: "adobe", loginMode: "manual" },
      })?.icon,
    );
    expect(getHttpApplicationIconSuggestion(saved)?.icon).toBeDefined();
  });

  it.each(["", "custom.example.test"])(
    "selects manual consent, preserving credentials/TLS/custom address %s",
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
          httpAutoMfa: { version: 1, enabled: true },
          httpAutoLoginSelectors: { passwordSelector: "#old" },
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
      choose("Website application", "Adobe Admin Console");
      expect(value()).toMatchObject({
        hostname: hostname || "adminconsole.adobe.com",
        protocol: hostname ? "http" : "https",
        port: hostname ? 8443 : 443,
        httpVerifySsl: false,
        username: saved.username,
        password: saved.password,
        httpApplication: {
          version: 1,
          id: "adobe-admin-console",
          loginMode: "manual",
        },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(value().httpAutoLoginSelectors).toBeUndefined();
      expect(resolveHttpApplicationLogin(value()).credentials).toBeNull();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Use Adobe Admin Console login address",
        }),
      );
      expect(value()).toMatchObject({
        hostname: "adminconsole.adobe.com",
        protocol: "https",
        port: 443,
        httpVerifySsl: false,
      });
      choose(
        "Application login mode",
        "Automatic form login — explicitly opt in",
      );
      expect(screen.getByLabelText("Website email")).toHaveValue(
        saved.username,
      );
      expect(
        screen.queryByText("Selector overrides (optional)"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/Staged email and password sign-in/),
      ).toHaveTextContent(
        "SSO, MFA, CAPTCHA and account/profile choice remain interactive",
      );
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: { username: saved.username, password: saved.password },
        autoLogin: true,
        upstreamAuthMode: "adobe-form",
        loginFlow: "adobe",
      });
    },
  );

  it("uses standard vault disclosure without inline fallback or Basic authentication", () => {
    const input = {
      ...saved,
      authType: "basic" as const,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(input)).toMatchObject({
      credentials: null,
      upstreamAuthMode: "adobe-form",
      loginFlow: "adobe",
    });
    const credentials = {
      username: "vault@example.test",
      password: "vault-fixture",
    };
    expect(resolveHttpApplicationLogin(input, credentials)).toEqual({
      credentials,
      autoLogin: true,
      upstreamAuthMode: "adobe-form",
      loginFlow: "adobe",
    });
    expect(
      resolveHttpApplicationLogin(
        {
          ...input,
          httpApplication: { ...saved.httpApplication!, loginMode: "manual" },
        },
        credentials,
      ),
    ).toEqual({
      credentials: null,
      autoLogin: false,
      upstreamAuthMode: "none",
    });
  });

  it.each([
    "http://adminconsole.adobe.com/",
    "https://adminconsole.adobe.com:8443/",
    "https://adminconsole.adobe.com.evil.test/",
    "https://account.adobe.com/",
    "https://user:pass@adminconsole.adobe.com/",
    "invalid",
  ])("rejects automatic target %s", (url) => {
    expect(() => validateHttpApplicationTarget(saved, url)).toThrow(
      /requires HTTPS at adminconsole.adobe.com/,
    );
  });
  it("accepts only the hosted HTTPS origin and leaves Adobe Account manual", () => {
    expect(() =>
      validateHttpApplicationTarget(
        saved,
        "https://adminconsole.adobe.com/overview",
      ),
    ).not.toThrow();
    const account = {
      ...saved,
      httpApplication: {
        version: 1 as const,
        id: "adobe",
        loginMode: "manual" as const,
      },
    };
    expect(getHttpApplicationProfile("adobe")).toMatchObject({
      label: "Adobe Account",
      hostedLoginUrl: "https://account.adobe.com/",
      capability: "manual",
    });
    expect(getReviewedApplicationProfile(account)).toBeUndefined();
    expect(resolveHttpApplicationLogin(account)).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    expect(() =>
      resolveHttpApplicationLogin({
        ...account,
        httpApplication: { ...account.httpApplication, loginMode: "form" },
      }),
    ).toThrow(/invalid/i);
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
  it("rejects selector overrides and missing credentials", () => {
    expect(() =>
      resolveHttpApplicationLogin({
        ...saved,
        httpAutoLoginSelectors: { usernameSelector: "#arbitrary" },
      }),
    ).toThrow(/does not accept selector overrides/);
    expect(() =>
      resolveHttpApplicationLogin({ ...saved, password: "" }),
    ).toThrow(/requires/);
  });
});
