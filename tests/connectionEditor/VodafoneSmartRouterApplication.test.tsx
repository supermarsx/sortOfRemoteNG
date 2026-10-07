import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Connection } from "../../src/types/connection/connection";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  normalizeHttpApplicationSelectors,
} from "../../src/utils/auth/httpApplicationLogin";
import {
  VODAFONE_SMART_ROUTER_PROFILE,
  VODAFONE_SMART_ROUTER_LOGIN_SELECTORS,
} from "../../src/utils/connection/vodafoneSmartRouterProfile";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";

const id = "vodafone-smart-router-3";
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};
const saved: Partial<Connection> = {
  protocol: "http",
  hostname: "192.0.2.1/login.asp",
  port: 8080,
  username: "fixture-user",
  password: "fixture-secret",
  icon: "server",
  httpApplication: { version: 1, id, loginMode: "manual" },
};

describe("Vodafone Smart Router 3 application", () => {
  it("registers a local router profile separately from My Vodafone", () => {
    expect(getHttpApplicationProfile(id)).toBe(VODAFONE_SMART_ROUTER_PROFILE);
    expect(getHttpApplicationProfile(id)).not.toBe(
      getHttpApplicationProfile("vodafone-portugal"),
    );
    expect(normalizeHttpApplicationSettings({ version: 1, id })).toEqual({
      version: 1,
      id,
      loginMode: "manual",
    });
    expect(VODAFONE_SMART_ROUTER_PROFILE.hostedLoginUrl).toBeUndefined();
    expect(VODAFONE_SMART_ROUTER_PROFILE.loginPath).toBeUndefined();
    expect(VODAFONE_SMART_ROUTER_PROFILE.loginModes).toEqual([
      "manual",
      "form",
    ]);
    expect(
      normalizeHttpApplicationSelectors(VODAFONE_SMART_ROUTER_LOGIN_SELECTORS),
    ).toEqual(VODAFONE_SMART_ROUTER_LOGIN_SELECTORS);
    expect(getHttpApplicationIconSuggestion(saved)?.icon.key).toBe(
      "vodafone-router",
    );
    expect(
      getHttpApplicationIconSuggestion({
        ...saved,
        httpApplication: {
          version: 1,
          id: "vodafone-portugal",
          loginMode: "manual",
        },
      })?.icon.key,
    ).toBe("vodafone");
  });

  it.each(["http", "https"] as const)(
    "preserves the configured %s address and icon and requires opt-in",
    (protocol) => {
      function Fixture() {
        const [formData, setFormData] = React.useState<Partial<Connection>>({
          ...saved,
          protocol,
          httpVerifySsl: false,
          httpAutoLogin: true,
          httpAutoLoginSelectors: { submitSelector: "#old-submit" },
          httpApplication: {
            version: 1,
            id: "generic-form",
            loginMode: "form",
          },
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
      choose("Website application", "Vodafone Smart Router 3");
      expect(value()).toMatchObject({
        ...saved,
        protocol,
        httpAutoLogin: false,
        httpVerifySsl: false,
      });
      expect(value().httpAutoLoginSelectors).toBeUndefined();
      expect(resolveHttpApplicationLogin(value()).credentials).toBeNull();
      choose(
        "Application login mode",
        "Automatic form login — explicitly opt in",
      );
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: { username: saved.username, password: saved.password },
        autoLogin: true,
        upstreamAuthMode: "none",
        selectors: VODAFONE_SMART_ROUTER_LOGIN_SELECTORS,
      });
      expect(value()).toMatchObject({
        protocol,
        hostname: saved.hostname,
        port: saved.port,
        icon: "server",
      });
      choose(
        "Application login mode",
        "Manual browsing — no saved credentials sent",
      );
      expect(resolveHttpApplicationLogin(value()).credentials).toBeNull();
    },
  );

  it("does not read secrets in manual mode", () => {
    const connection = { ...saved, httpAutoLogin: true };
    Object.defineProperty(connection, "password", {
      get() {
        throw new Error("Secret read");
      },
    });
    expect(resolveHttpApplicationLogin(connection)).toEqual({
      credentials: null,
      autoLogin: false,
      upstreamAuthMode: "none",
    });
  });

  it("uses owning-vault credentials without falling back to local passwords", () => {
    const connection: Partial<Connection> = {
      ...saved,
      httpApplication: { version: 1, id, loginMode: "form" },
      credentialSource: {
        kind: "vault",
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(connection)).toMatchObject({
      credentials: null,
      autoLogin: true,
      selectors: VODAFONE_SMART_ROUTER_LOGIN_SELECTORS,
    });
    const credentials = { username: "vault-user", password: "vault-fixture" };
    expect(
      resolveHttpApplicationLogin(connection, credentials).credentials,
    ).toEqual(credentials);
    expect(connection.password).toBe(saved.password);
  });

  it.each(["basic", "digest"] as const)(
    "rejects unsupported imported %s authentication",
    (loginMode) => {
      expect(() =>
        resolveHttpApplicationLogin({
          ...saved,
          httpApplication: { version: 1, id, loginMode },
        }),
      ).toThrow(/invalid/i);
    },
  );
});
