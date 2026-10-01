import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import {
  EXCHANGE_ECP_PROFILE,
  EXCHANGE_ECP_LOGIN_SELECTORS,
} from "../../src/utils/connection/exchangeEcpProfile";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";

const saved: Partial<Connection> = {
  protocol: "https",
  hostname: "mail.example.test",
  port: 8443,
  username: "DOMAIN\\user",
  password: "fixture-secret",
  domain: "DO-NOT-INVENT",
  httpVerifySsl: true,
  httpApplication: { version: 1, id: "exchange-ecp", loginMode: "form" },
};
describe("Exchange ECP reviewed application", () => {
  it.each([true, false])(
    "requires fresh manual consent without replacing endpoint, TLS=%s or credentials",
    (verifySsl) => {
      function Fixture() {
        const [formData, setFormData] = React.useState<Partial<Connection>>({
          ...saved,
          httpVerifySsl: verifySsl,
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
      const choose = (label: string, option: string) => {
        fireEvent.click(screen.getByLabelText(label));
        fireEvent.mouseDown(screen.getByRole("option", { name: option }));
      };
      choose("Website application", "Exchange Admin Center / ECP");
      expect(value()).toMatchObject({
        protocol: saved.protocol,
        hostname: saved.hostname,
        port: saved.port,
        username: saved.username,
        password: saved.password,
        domain: saved.domain,
        httpVerifySsl: verifySsl,
        httpApplication: {
          version: 1,
          id: "exchange-ecp",
          loginMode: "manual",
        },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(value().httpAutoLoginSelectors).toBeUndefined();
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: null,
        upstreamAuthMode: "none",
        autoLogin: false,
      });
      choose(
        "Application login mode",
        "Automatic form login — explicitly opt in",
      );
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: { username: saved.username, password: saved.password },
        upstreamAuthMode: "none",
        autoLogin: true,
        selectors: EXCHANGE_ECP_LOGIN_SELECTORS,
      });
    },
  );
  it("keeps the stable id, manual default, /ecp/ entry and dedicated reviewed marker", () => {
    expect(getHttpApplicationProfile("exchange-ecp")).toBe(
      EXCHANGE_ECP_PROFILE,
    );
    expect(EXCHANGE_ECP_PROFILE).toMatchObject({
      loginPath: "/ecp/",
      requiresHttps: true,
      loginModes: ["manual", "form"],
      selectors: EXCHANGE_ECP_LOGIN_SELECTORS,
    });
    expect(EXCHANGE_ECP_PROFILE.hostedLoginUrl).toBeUndefined();
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "exchange-ecp" }),
    ).toEqual({ version: 1, id: "exchange-ecp", loginMode: "manual" });
    expect(getReviewedApplicationProfile(saved)).toBe("exchange-ecp");
    expect(
      getReviewedApplicationProfile({
        ...saved,
        httpApplication: { ...saved.httpApplication!, invalid: true },
      }),
    ).toBeUndefined();
  });
  it.each(["DOMAIN\\user", "user@example.test", "shortname"])(
    "preserves the exact account format %s without inventing a domain",
    (username) => {
      const input = { ...saved, username };
      const snapshot = structuredClone(input);
      expect(resolveHttpApplicationLogin(input)).toEqual({
        credentials: { username, password: saved.password },
        upstreamAuthMode: "none",
        autoLogin: true,
        selectors: EXCHANGE_ECP_LOGIN_SELECTORS,
      });
      expect(input).toEqual(snapshot);
    },
  );
  it("requires vault disclosure and never falls back to stale inline credentials", () => {
    const input = {
      ...saved,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(input).credentials).toBeNull();
    const vault = { username: "VAULT\\exact", password: "vault-fixture" };
    expect(resolveHttpApplicationLogin(input, vault)).toEqual({
      credentials: vault,
      upstreamAuthMode: "none",
      autoLogin: true,
      selectors: EXCHANGE_ECP_LOGIN_SELECTORS,
    });
    expect(
      resolveHttpApplicationLogin(
        {
          ...input,
          httpApplication: {
            version: 1,
            id: "exchange-ecp",
            loginMode: "manual",
          },
        },
        vault,
      ),
    ).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
  });
  it.each([
    "http://mail.example.test/ecp/",
    "https://user:secret@mail.example.test/ecp/",
    "not a URL",
  ])("rejects insecure or credential-bearing target %s", (url) => {
    expect(() => validateHttpApplicationTarget(saved, url)).toThrow(
      /requires.*HTTPS/,
    );
  });
  it.each([
    "https://mail.example.test:8443/ecp/",
    "https://mail.example.test:8443/owa/auth/logon.aspx?url=%2Fecp%2F",
  ])("accepts HTTPS deployment path %s", (url) => {
    expect(() => validateHttpApplicationTarget(saved, url)).not.toThrow();
  });
  it.each(["basic", "digest"] as const)(
    "rejects imported %s mode instead of falling back to HTTP authentication",
    (loginMode) => {
      expect(() =>
        resolveHttpApplicationLogin({
          ...saved,
          authType: "basic",
          httpApplication: { version: 1, id: "exchange-ecp", loginMode },
        }),
      ).toThrow(/invalid/i);
    },
  );
  it("never sends Basic even with legacy auth flags; generic Exchange stays manual", () => {
    expect(
      resolveHttpApplicationLogin({
        ...saved,
        authType: "basic",
        httpAutoLogin: true,
      }).upstreamAuthMode,
    ).toBe("none");
    const generic = {
      ...saved,
      authType: "basic" as const,
      httpAutoLogin: true,
      httpApplication: {
        version: 1 as const,
        id: "exchange",
        loginMode: "manual" as const,
      },
    };
    expect(getHttpApplicationProfile("exchange")).toMatchObject({
      capability: "manual",
    });
    expect(getReviewedApplicationProfile(generic)).toBeUndefined();
    expect(resolveHttpApplicationLogin(generic)).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
    expect(() =>
      resolveHttpApplicationLogin({
        ...generic,
        httpApplication: { version: 1, id: "exchange", loginMode: "form" },
      }),
    ).toThrow(/invalid/i);
  });
});
