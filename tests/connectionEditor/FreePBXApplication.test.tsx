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
  getReviewedApplicationProfile,
  resolveHttpApplicationLogin,
} from "../../src/utils/auth/httpApplicationLogin";
import { getHttpApplicationExternalTarget } from "../../src/utils/auth/httpApplicationExternal";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";

const saved: Partial<Connection> = {
  protocol: "https",
  hostname: "pbx.example.test",
  port: 8443,
  username: "web-admin",
  password: "fixture-password",
  httpApplication: { version: 1, id: "freepbx", loginMode: "form" },
};

describe("FreePBX Administration application mapping", () => {
  it.each(["http", "https"] as const)(
    "selects manual %s and requires explicit form opt-in without rewriting connection policy",
    (protocol) => {
      const initial: Partial<Connection> = {
        ...saved,
        protocol,
        httpApplication: undefined,
        httpAutoLogin: true,
        httpVerifySsl: true,
        icon: "server",
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
      choose("Website application", "FreePBX Administration");
      expect(value()).toMatchObject({
        protocol,
        hostname: saved.hostname,
        port: 8443,
        username: saved.username,
        password: saved.password,
        icon: "server",
        httpVerifySsl: true,
        httpApplication: { version: 1, id: "freepbx", loginMode: "manual" },
        httpAutoLogin: false,
        httpAutoMfa: { version: 1, enabled: false },
      });
      expect(
        screen.getByText(/UCP \(\/ucp\) is a separate user portal/),
      ).toBeInTheDocument();
      expect(resolveHttpApplicationLogin(value())).toEqual({
        credentials: null,
        autoLogin: false,
        upstreamAuthMode: "none",
      });
      choose(
        "Application login mode",
        "Automatic form login — explicitly opt in",
      );
      expect(resolveHttpApplicationLogin(value())).toMatchObject({
        autoLogin: true,
        upstreamAuthMode: "none",
        credentials: { username: saved.username, password: saved.password },
        selectors: getHttpApplicationProfile("freepbx")!.selectors,
      });
      expect(value().httpApplication).not.toHaveProperty("password");
    },
  );

  it("resolves vault credentials through the existing volatile path without local fallback", () => {
    const connection = {
      ...saved,
      credentialSource: {
        kind: "vault" as const,
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(connection).credentials).toBeNull();
    const vault = { username: "vault-admin", password: "vault-fixture" };
    expect(resolveHttpApplicationLogin(connection, vault)).toMatchObject({
      credentials: vault,
      autoLogin: true,
      upstreamAuthMode: "none",
    });
    expect(connection.password).toBe("fixture-password");
    // Native compatibility identity is independent of credential storage;
    // it grants neither transport authentication nor local vault fallback.
    expect(getReviewedApplicationProfile(connection)).toBe("freepbx");
  });

  it("defaults to the admin pathname and existing icon with no MFA contract", () => {
    const profile = getHttpApplicationProfile("freepbx")!;
    expect(profile.loginPath).toBe("/admin/");
    expect(profile.totpChallenges).toBeUndefined();
    expect(profile.loginFlow).toBeUndefined();
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "freepbx" }),
    ).toEqual({ version: 1, id: "freepbx", loginMode: "manual" });
    expect(
      normalizeHttpApplicationSettings(
        JSON.parse(JSON.stringify(saved.httpApplication)),
      ),
    ).toEqual(saved.httpApplication);
    expect(getHttpApplicationIconSuggestion(saved)?.icon.key).toBe("freepbx");
    expect(
      getHttpApplicationExternalTarget(
        saved,
        "https://pbx.example.test:8443/current?private=value",
      ),
    ).toEqual({
      label: "FreePBX Administration",
      url: "https://pbx.example.test:8443/admin/",
    });
    expect(
      getHttpApplicationExternalTarget(
        saved,
        "https://other.example.test/admin",
      ),
    ).toBeNull();
  });

  it.each(["basic", "digest"])(
    "rejects imported %s mode instead of sending transport credentials",
    (loginMode) => {
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
    },
  );

  it("uses the directory base for relative admin assets", () => {
    const base = new URL(
      getHttpApplicationProfile("freepbx")!.loginPath!,
      "http://protected.localhost:9000",
    );
    for (const asset of [
      "assets/css/bootstrap.css",
      "assets/js/jquery.js",
      "images/tango.png",
    ]) {
      const resolved = new URL(asset, base);
      expect(resolved.origin).toBe(base.origin);
      expect(resolved.pathname).toBe(`/admin/${asset}`);
    }
  });
});
