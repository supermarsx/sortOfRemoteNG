import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import {
  OPNSENSE_LOGIN_SELECTORS,
  OPNSENSE_PROFILE,
} from "../../src/utils/connection/opnsenseProfile";
import {
  getHttpApplicationProfile,
  normalizeHttpApplicationSettings,
} from "../../src/utils/connection/httpApplicationProfiles";
import {
  resolveHttpApplicationLogin,
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";

const saved: Partial<Connection> = {
  protocol: "https",
  hostname: "firewall.example.test",
  port: 8443,
  username: "fixture-admin",
  password: "fixture-secret",
  httpApplication: { version: 1, id: "opnsense", loginMode: "manual" },
};
const choose = (label: string, option: string) => {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
};

describe("OPNsense application integration", () => {
  it("registers the reviewed profile, manual default and existing brand icon", () => {
    expect(getHttpApplicationProfile("opnsense")).toBe(OPNSENSE_PROFILE);
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "opnsense" }),
    ).toEqual({ version: 1, id: "opnsense", loginMode: "manual" });
    expect(getHttpApplicationIconSuggestion(saved)?.icon.key).toBe("opnsense");
  });

  it.each(["", "firewall.example.test", "192.0.2.1", "[2001:db8::1]"])(
    "preserves configured appliance %s, TLS policy and credentials on selection",
    (hostname) => {
      function Fixture() {
        const [formData, setFormData] = React.useState<Partial<Connection>>({
          ...saved,
          hostname,
          icon: "server",
          httpVerifySsl: false,
          httpApplication: { version: 1, id: "pfsense", loginMode: "form" },
          httpAutoLogin: true,
          httpAutoLoginSelectors: { submitSelector: 'input[name="login"]' },
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
      choose("Website application", "OPNsense");
      expect(value()).toMatchObject({
        ...saved,
        hostname,
        icon: "server",
        httpVerifySsl: false,
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
        screen.queryByRole("button", { name: /Use OPNsense login address/i }),
      ).not.toBeInTheDocument();
      choose(
        "Application login mode",
        "Automatic form login — explicitly opt in",
      );
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: { username: saved.username, password: saved.password },
        autoLogin: true,
        upstreamAuthMode: "none",
        selectors: OPNSENSE_LOGIN_SELECTORS,
      });
      expect(value()).toMatchObject({
        hostname,
        port: 8443,
        protocol: "https",
        icon: "server",
        httpVerifySsl: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      choose(
        "Application login mode",
        "Manual browsing — no saved credentials sent",
      );
      expect(resolveHttpApplicationLogin(value()).credentials).toBeNull();
    },
  );

  it("manual mode never reads stored passwords, even with a stale auto-login flag", () => {
    const connection = { ...saved, httpAutoLogin: true };
    for (const key of ["password", "basicAuthPassword"])
      Object.defineProperty(connection, key, {
        get: () => {
          throw new Error("Manual browsing read a secret");
        },
      });
    expect(resolveHttpApplicationLogin(connection)).toEqual({
      credentials: null,
      autoLogin: false,
      upstreamAuthMode: "none",
    });
  });

  it("uses deferred owning-vault resolution without copying local credentials or Basic auth", () => {
    const connection: Partial<Connection> = {
      ...saved,
      authType: "basic",
      httpApplication: { version: 1, id: "opnsense", loginMode: "form" },
      credentialSource: {
        kind: "vault",
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(connection)).toEqual({
      credentials: null,
      autoLogin: true,
      upstreamAuthMode: "none",
      selectors: OPNSENSE_LOGIN_SELECTORS,
    });
    const credentials = { username: "vault-admin", password: "vault-fixture" };
    expect(resolveHttpApplicationLogin(connection, credentials)).toEqual({
      credentials,
      autoLogin: true,
      upstreamAuthMode: "none",
      selectors: OPNSENSE_LOGIN_SELECTORS,
    });
    expect(connection.password).toBe(saved.password);
  });

  it.each(["basic", "digest"] as const)(
    "rejects imported %s login mode",
    (loginMode) => {
      expect(() =>
        resolveHttpApplicationLogin({
          ...saved,
          httpApplication: { version: 1, id: "opnsense", loginMode },
        }),
      ).toThrow(/invalid/i);
    },
  );

  it.each([
    "https://firewall.example.test:8443/",
    "https://192.0.2.1:9443/index.php",
    "https://[2001:db8::1]:8443/",
  ])("accepts a self-hosted HTTPS authority: %s", (target) => {
    expect(() => validateHttpApplicationTarget(saved, target)).not.toThrow();
  });

  it.each([
    "http://firewall.example.test:8443/",
    "https://user:pass@firewall.example.test:8443/",
    "not a URL",
  ])("rejects invalid or unprotected target %s", (target) => {
    expect(() => validateHttpApplicationTarget(saved, target)).toThrow(/HTTPS/);
  });

  it("keeps explicit external handoff on the saved appliance, without session query data", () => {
    expect(
      getHttpApplicationExternalTarget(
        saved,
        "https://firewall.example.test:8443/index.php?url=%2Fui&session=fixture#fragment",
      ),
    ).toEqual({
      label: "OPNsense",
      url: "https://firewall.example.test:8443/",
    });
    expect(
      getHttpApplicationExternalTarget(saved, "https://foreign.example/"),
    ).toBeNull();
    expect(
      getHttpApplicationExternalTarget(saved, "https://firewall.example.test/"),
    ).toBeNull();
  });
});
