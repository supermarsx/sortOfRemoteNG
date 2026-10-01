import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import { CANVA_PROFILE } from "../../src/utils/connection/canvaProfile";
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
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";

const saved: Partial<Connection> = {
  protocol: "https",
  hostname: "www.canva.com",
  port: 443,
  username: "fixture@example.test",
  password: "fixture-only",
  httpApplication: { version: 1, id: "canva", loginMode: "form" },
};
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};

describe("Canva generic hosted assistance", () => {
  it("offers manual/form only, no guessed selectors, staged flow or MFA grant", () => {
    expect(getHttpApplicationProfile("canva")).toBe(CANVA_PROFILE);
    expect(CANVA_PROFILE).toMatchObject({
      capability: "generic-form",
      hostedLoginUrl: "https://www.canva.com/login/",
      requiresHttps: true,
      loginModes: ["manual", "form"],
    });
    expect(CANVA_PROFILE.selectors).toBeUndefined();
    expect(CANVA_PROFILE.loginFlow).toBeUndefined();
    expect(CANVA_PROFILE.totpChallenges).toBeUndefined();
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "canva" })?.loginMode,
    ).toBe("manual");
    expect(getReviewedApplicationProfile(saved)).toBe("canva");
    expect(
      getReviewedApplicationProfile({
        ...saved,
        httpApplication: { ...saved.httpApplication!, invalid: true },
      }),
    ).toBeUndefined();
    expect(getHttpApplicationIconSuggestion(saved)?.icon.key).toBe("canva");
    expect(
      getHttpApplicationExternalTarget(
        saved,
        "https://www.canva.com/login/?untrusted=value",
      ),
    ).toEqual({ label: "Canva", url: "https://www.canva.com/login/" });
  });

  it.each(["", "custom.example.test"])(
    "requires opt-in, preserves custom address %s and explains the boundary",
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
      choose("Website application", "Canva");
      expect(value()).toMatchObject({
        hostname: hostname || "www.canva.com",
        protocol: hostname ? "http" : "https",
        port: hostname ? 8443 : 443,
        username: saved.username,
        password: saved.password,
        httpVerifySsl: false,
        httpApplication: { version: 1, id: "canva", loginMode: "manual" },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(value().httpAutoLoginSelectors).toBeUndefined();
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: null,
        autoLogin: false,
        upstreamAuthMode: "none",
      });
      expect(
        screen.getByText(/Generic email\/password form assistance/),
      ).toHaveTextContent("Canva staged email/code/SSO flow not verified");
      fireEvent.click(
        screen.getByRole("button", { name: "Use Canva login address" }),
      );
      expect(value()).toMatchObject({
        hostname: "www.canva.com",
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
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: { username: saved.username, password: saved.password },
        autoLogin: true,
        upstreamAuthMode: "none",
      });
    },
  );

  it("uses the standard saved/vault resolver without Basic fallback or routing-marker credential grant", () => {
    expect(
      resolveHttpApplicationLogin({ ...saved, authType: "basic" }),
    ).toEqual({
      credentials: { username: saved.username, password: saved.password },
      upstreamAuthMode: "none",
      autoLogin: true,
    });
    const input = {
      ...saved,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(input).credentials).toBeNull();
    const credentials = {
      username: "vault@example.test",
      password: "vault-fixture",
    };
    expect(resolveHttpApplicationLogin(input, credentials)).toEqual({
      credentials,
      autoLogin: true,
      upstreamAuthMode: "none",
    });
    const manual = {
      ...input,
      httpApplication: {
        ...saved.httpApplication!,
        loginMode: "manual" as const,
      },
    };
    expect(getReviewedApplicationProfile(manual)).toBe("canva");
    expect(resolveHttpApplicationLogin(manual, credentials)).toEqual({
      credentials: null,
      autoLogin: false,
      upstreamAuthMode: "none",
    });
  });
  it("retains explicit user selector overrides without inventing provider selectors", () => {
    const selectors = {
      usernameSelector: "#user-configured-email",
      passwordSelector: "#user-configured-password",
      submitSelector: "#user-configured-submit",
    };
    expect(
      resolveHttpApplicationLogin({
        ...saved,
        httpAutoLoginSelectors: selectors,
      }).selectors,
    ).toEqual(selectors);
  });
  it.each([
    "http://www.canva.com/login/",
    "https://canva.com/",
    "https://www.canva.com:8443/",
    "https://static.canva.com/",
    "https://www.canva.com.evil.test/",
    "https://user:pass@www.canva.com/",
  ])("rejects noncanonical entry origin %s", (url) => {
    expect(() => validateHttpApplicationTarget(saved, url)).toThrow(
      /requires HTTPS at www.canva.com/,
    );
  });
  it("accepts the canonical HTTPS login", () => {
    expect(() =>
      validateHttpApplicationTarget(saved, "https://www.canva.com/login/"),
    ).not.toThrow();
  });
  it.each(["basic", "digest"] as const)(
    "rejects imported %s auth",
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
