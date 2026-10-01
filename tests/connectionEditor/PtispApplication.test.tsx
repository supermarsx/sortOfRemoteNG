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
  PTISP_LOGIN_SELECTORS,
  PTISP_LOGIN_URL,
} from "../../src/utils/connection/ptispProfile";
import {
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";

const saved: Partial<Connection> = {
  protocol: "https",
  hostname: "my.ptisp.pt",
  port: 443,
  username: "fixture@example.test",
  password: "fixture-secret",
  httpApplication: { version: 1, id: "ptisp", loginMode: "form" },
};

describe("PTisp customer area profile", () => {
  it("sets the portal address, preserves TLS policy and requires fresh login consent", () => {
    function Fixture() {
      const [formData, setFormData] = React.useState<Partial<Connection>>({
        ...saved,
        protocol: "http",
        hostname: "other.test",
        port: 8080,
        icon: "server",
        httpVerifySsl: true,
        httpApplication: { version: 1, id: "generic-form", loginMode: "form" },
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
    const choose = (label: string, option: string) => {
      fireEvent.click(screen.getByLabelText(label));
      fireEvent.mouseDown(screen.getByRole("option", { name: option }));
    };
    choose("Website application", "PTisp customer area");
    expect(value()).toMatchObject({
      protocol: "https",
      hostname: "my.ptisp.pt",
      port: 443,
      icon: "server",
      httpVerifySsl: true,
      username: saved.username,
      password: saved.password,
      httpApplication: { version: 1, id: "ptisp", loginMode: "manual" },
      httpAutoLogin: false,
      httpAutoMfa: { version: 1, enabled: false },
    });
    expect(value().httpAutoLoginSelectors).toBeUndefined();
    expect(screen.getByText(PTISP_LOGIN_URL)).toBeInTheDocument();
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
      selectors: PTISP_LOGIN_SELECTORS,
      credentials: { username: saved.username, password: saved.password },
    });
  });

  it("retains the stable saved id and manual default; supports vault credentials without transport auth", () => {
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "ptisp" }),
    ).toEqual({ version: 1, id: "ptisp", loginMode: "manual" });
    expect(getHttpApplicationProfile("ptisp")).toMatchObject({
      hostedLoginUrl: PTISP_LOGIN_URL,
      loginPath: "/login",
      requiresHttps: true,
    });
    expect(getHttpApplicationProfile("ptisp")!.totpChallenges).toBeUndefined();
    expect(getReviewedApplicationProfile(saved)).toBe("ptisp");
    expect(
      getReviewedApplicationProfile({
        ...saved,
        httpApplication: { ...saved.httpApplication!, invalid: true },
      }),
    ).toBeUndefined();
    const vault = { username: "vault@example.test", password: "vault-fixture" };
    const connection = {
      ...saved,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(connection).credentials).toBeNull();
    expect(resolveHttpApplicationLogin(connection, vault)).toMatchObject({
      credentials: vault,
      upstreamAuthMode: "none",
      selectors: PTISP_LOGIN_SELECTORS,
    });
  });

  it.each([
    "http://my.ptisp.pt/login",
    "https://my.ptisp.pt:444/login",
    "https://api3.ptisp.pt/login",
    "https://my.ptisp.pt.attacker.test/login",
    "https://user@my.ptisp.pt/login",
  ])("refuses a noncanonical dashboard: %s", (url) => {
    expect(() => validateHttpApplicationTarget(saved, url)).toThrow(
      /requires HTTPS/,
    );
  });

  it("accepts only the exact dashboard origin and rejects HTTP-auth imports", () => {
    expect(() =>
      validateHttpApplicationTarget(saved, PTISP_LOGIN_URL),
    ).not.toThrow();
    for (const loginMode of ["basic", "digest"] as const)
      expect(() =>
        resolveHttpApplicationLogin({
          ...saved,
          httpApplication: { version: 1, id: "ptisp", loginMode },
        }),
      ).toThrow(/invalid/);
  });
});
