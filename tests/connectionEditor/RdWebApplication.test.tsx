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
  validateHttpApplicationTarget,
} from "../../src/utils/auth/httpApplicationLogin";
import {
  RD_WEB_LOGIN_SELECTORS,
  RD_WEB_PROFILE,
} from "../../src/utils/connection/rdWebProfile";
import { getHttpApplicationIconSuggestion } from "../../src/utils/icons/httpApplicationIconSuggestions";
import { CONNECTION_ICON_CATALOG } from "../../src/utils/icons/connectionIconCatalog";

const connection: Partial<Connection> = {
  protocol: "https",
  hostname: "rdweb.example.test",
  port: 443,
  username: "EXAMPLE\\fixture-user",
  password: "fixture-password",
  httpApplication: { version: 1, id: "rdweb", loginMode: "form" },
};

function Fixture({ initial }: { initial: Partial<Connection> }) {
  const [formData, setFormData] = React.useState(initial);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application"]}
      />
      <output data-testid="rdweb-record">{JSON.stringify(formData)}</output>
    </>
  );
}
const read = () =>
  JSON.parse(
    screen.getByTestId("rdweb-record").textContent!,
  ) as Partial<Connection>;
function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}

describe("registered RD Web Access preset", () => {
  it("keeps persisted manual configurations valid and normalizes only explicit form mode", () => {
    expect(getHttpApplicationProfile("rdweb")).toBe(RD_WEB_PROFILE);
    expect(
      normalizeHttpApplicationSettings({ version: 1, id: "rdweb" }),
    ).toEqual({
      version: 1,
      id: "rdweb",
      loginMode: "manual",
    });
    for (const loginMode of ["manual", "form"] as const) {
      const settings = { version: 1 as const, id: "rdweb", loginMode };
      expect(normalizeHttpApplicationSettings(settings)).toEqual(settings);
      expect(
        normalizeHttpApplicationSettings(JSON.parse(JSON.stringify(settings))),
      ).toEqual(settings);
    }
  });

  it("does not read old passwords or forward transport auth in manual mode", () => {
    const manual = {
      ...connection,
      authType: "basic" as const,
      httpAutoLogin: true,
      httpApplication: {
        version: 1 as const,
        id: "rdweb",
        loginMode: "manual" as const,
      },
    };
    for (const key of ["password", "basicAuthPassword"])
      Object.defineProperty(manual, key, {
        get: () => {
          throw new Error("Manual mode read a secret");
        },
      });
    expect(resolveHttpApplicationLogin(manual)).toEqual({
      credentials: null,
      upstreamAuthMode: "none",
      autoLogin: false,
    });
  });

  it.each([
    "EXAMPLE\\fixture-user",
    "fixture-user@example.test",
    "fixture-user",
  ])(
    "resolves local %s unchanged with the actual reviewed selectors",
    (username) => {
      expect(resolveHttpApplicationLogin({ ...connection, username })).toEqual({
        credentials: { username, password: connection.password },
        autoLogin: true,
        upstreamAuthMode: "none",
        selectors: RD_WEB_LOGIN_SELECTORS,
      });
      expect(getReviewedApplicationProfile(connection)).toBeUndefined();
    },
  );

  it("uses only the explicitly supplied owning-vault result, never stale local secrets", () => {
    const vault: Partial<Connection> = {
      ...connection,
      credentialSource: {
        kind: "vault",
        credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
      },
    };
    expect(resolveHttpApplicationLogin(vault)).toEqual({
      credentials: null,
      autoLogin: true,
      upstreamAuthMode: "none",
      selectors: RD_WEB_LOGIN_SELECTORS,
    });
    const supplied = {
      username: "VAULT\\fixture-user",
      password: "vault-fixture-password",
    };
    expect(resolveHttpApplicationLogin(vault, supplied)).toEqual({
      credentials: supplied,
      autoLogin: true,
      upstreamAuthMode: "none",
      selectors: RD_WEB_LOGIN_SELECTORS,
    });
    expect(vault.password).toBe("fixture-password");
  });

  it.each(["basic", "digest"] as const)(
    "rejects imported %s application modes",
    (loginMode) => {
      const settings = { version: 1 as const, id: "rdweb", loginMode };
      expect(normalizeHttpApplicationSettings(settings)?.invalid).toBe(true);
      expect(() =>
        resolveHttpApplicationLogin({
          ...connection,
          httpApplication: settings,
        }),
      ).toThrow(/invalid/i);
    },
  );

  it("requires HTTPS while retaining an organization's server and custom TLS port", () => {
    expect(() =>
      validateHttpApplicationTarget(
        connection,
        "https://rdweb.example.test/RDWeb/",
      ),
    ).not.toThrow();
    expect(() =>
      validateHttpApplicationTarget(
        { ...connection, port: 8443 },
        "https://rdweb.example.test:8443/RDWeb/",
      ),
    ).not.toThrow();
    expect(() =>
      validateHttpApplicationTarget(
        connection,
        "http://rdweb.example.test/RDWeb/",
      ),
    ).toThrow(/requires an HTTPS/);
    expect(() =>
      validateHttpApplicationTarget(
        connection,
        "https://user:secret@rdweb.example.test/RDWeb/",
      ),
    ).toThrow(/requires an HTTPS/);
  });

  it("registers a dedicated RDWeb icon instead of using the generic Microsoft brand", () => {
    expect(getHttpApplicationIconSuggestion(connection)?.icon.key).toBe(
      "rd-web-access",
    );
    expect(
      CONNECTION_ICON_CATALOG.filter((icon) => icon.key === "rd-web-access"),
    ).toHaveLength(1);
  });

  it("offers a themed manual/form choice, retains custom settings and requires opt-in", () => {
    render(
      <Fixture
        initial={{
          ...connection,
          hostname: "rdweb.example.test/RDWeb/Pages/pt-PT/login.aspx",
          port: 8443,
          icon: "star",
          httpVerifySsl: true,
          httpApplication: {
            version: 1,
            id: "generic-form",
            loginMode: "form",
          },
          httpAutoLogin: true,
          httpAutoLoginSelectors: { passwordSelector: "#old-password" },
          httpAutoMfa: { version: 1, enabled: true },
        }}
      />,
    );
    choose("Website application", RD_WEB_PROFILE.label);
    expect(read()).toMatchObject({
      hostname: "rdweb.example.test/RDWeb/Pages/pt-PT/login.aspx",
      protocol: "https",
      port: 8443,
      icon: "star",
      httpVerifySsl: true,
      username: connection.username,
      password: connection.password,
      httpApplication: { version: 1, id: "rdweb", loginMode: "manual" },
      httpAutoLogin: false,
      httpAutoMfa: { version: 1, enabled: false },
    });
    expect(read().httpAutoLoginSelectors).toBeUndefined();
    expect(resolveHttpApplicationLogin(read()).credentials).toBeNull();
    const picker = screen.getByLabelText("Application login mode");
    expect(picker.tagName).toBe("BUTTON");
    fireEvent.click(picker);
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(
      screen.queryByRole("option", { name: "HTTP Basic authentication" }),
    ).not.toBeInTheDocument();
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "Automatic form login — explicitly opt in",
      }),
    );
    expect(read().httpApplication?.loginMode).toBe("form");
    expect(resolveHttpApplicationLogin(read())).toEqual({
      credentials: {
        username: connection.username,
        password: connection.password,
      },
      autoLogin: true,
      upstreamAuthMode: "none",
      selectors: RD_WEB_LOGIN_SELECTORS,
    });
    expect(
      screen.getByText(/no domain is guessed or added/),
    ).toBeInTheDocument();
    choose(
      "Application login mode",
      "Manual browsing — no saved credentials sent",
    );
    expect(resolveHttpApplicationLogin(read()).autoLogin).toBe(false);
    expect(resolveHttpApplicationLogin(read()).credentials).toBeNull();
  });
});
