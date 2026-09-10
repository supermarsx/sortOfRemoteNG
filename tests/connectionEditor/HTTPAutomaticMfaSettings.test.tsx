import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";

const initial: Partial<Connection> = {
  protocol: "https",
  hostname: "rmm.example.test",
  port: 8443,
  httpVerifySsl: true,
  username: "old-user",
  password: "old-password",
  httpApplication: { version: 1, id: "tacticalrmm", loginMode: "manual" },
  totpConfigs: [
    {
      secret: "JBSWY3DPEHPK3PXP",
      issuer: "Fixture",
      account: "admin",
      digits: 6,
      period: 30,
      algorithm: "sha1",
    },
  ],
};
function Fixture({ value = initial }: { value?: Partial<Connection> }) {
  const [formData, setFormData] = React.useState(value);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application"]}
      />
      <button
        onClick={() =>
          setFormData((old) => ({ ...old, hostname: "changed.example.test" }))
        }
      >
        Change host fixture
      </button>
      <output data-testid="draft">{JSON.stringify(formData)}</output>
    </>
  );
}
const draft = () =>
  JSON.parse(screen.getByTestId("draft").textContent!) as Partial<Connection>;
function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
const enable = () =>
  screen.getByRole("button", {
    name: "Enable automatic codes for this origin",
  });

describe("explicit linked website authenticator consent", () => {
  it.each([
    ["GitHub", "github", "github.com"],
    ["Brevo", "brevo", "login.brevo.com"],
  ])(
    "%s requires a separate explicit hosted-address action",
    (label, id, hostname) => {
      render(<Fixture />);
      choose("Website application", label);
      expect(draft().hostname).toBe(initial.hostname);
      expect(draft().httpApplication).toMatchObject({
        id,
        loginMode: "manual",
      });
      expect(draft().httpAutoMfa?.enabled).toBe(false);
      fireEvent.click(
        screen.getByRole("button", { name: `Use ${label} login address` }),
      );
      expect(draft()).toMatchObject({
        protocol: "https",
        hostname,
        port: 443,
        httpVerifySsl: true,
        password: initial.password,
      });
      expect(draft().httpAutoMfa?.enabled).toBe(false);
    },
  );
  it("never chooses the first authenticator or enables automatically; stores only a stable reference and HTTPS pin", () => {
    render(<Fixture />);
    expect(enable()).toBeDisabled();
    expect(draft().httpAutoMfa).toBeUndefined();
    choose("Connection authenticator", "Fixture — admin");
    expect(draft().httpAutoMfa).toEqual({ version: 1, enabled: false });
    fireEvent.click(enable());
    const value = draft();
    expect(value.httpAutoMfa).toEqual({
      version: 1,
      enabled: true,
      totpConfigId: value.totpConfigs![0].id,
      challengeId: "tacticalrmm-totp",
      origin: "https://rmm.example.test:8443",
    });
    expect(value.totpConfigs![0].id).toMatch(/^[a-f0-9-]{36}$/);
    expect(value.totpConfigs![0].secret).toBe(initial.totpConfigs![0].secret);
    expect(value.httpApplication?.loginMode).toBe("manual");
    expect(value.httpVerifySsl).toBe(true);
    expect(value.password).toBe("old-password");
    expect(JSON.stringify(value.httpAutoMfa)).not.toContain(
      initial.totpConfigs![0].secret,
    );
    expect(
      screen.getByText(/Save the connection to apply consent/),
    ).toBeInTheDocument();
  });
  it("does not silently rebind an existing consent when the host changes", () => {
    render(
      <Fixture
        value={{
          ...initial,
          totpConfigs: [{ ...initial.totpConfigs![0], id: "existing" }],
          httpAutoMfa: {
            version: 1,
            enabled: true,
            totpConfigId: "existing",
            challengeId: "tacticalrmm-totp",
            origin: "https://rmm.example.test:8443",
          },
        }}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Change host fixture" }),
    );
    expect(draft().httpAutoMfa?.origin).toBe("https://rmm.example.test:8443");
    expect(screen.getByText(/The address changed:/)).toBeInTheDocument();
    fireEvent.click(enable());
    expect(draft().httpAutoMfa?.origin).toBe(
      "https://changed.example.test:8443",
    );
    expect(draft().httpAutoMfa?.totpConfigId).toBe("existing");
  });
  it("requires HTTPS, an authenticator and a reviewed challenge", () => {
    render(<Fixture value={{ ...initial, protocol: "http" }} />);
    choose("Connection authenticator", "Fixture — admin");
    expect(enable()).toBeDisabled();
    expect(screen.getByText(/Set a valid HTTPS host/)).toBeInTheDocument();
    expect(draft().httpAutoMfa?.enabled).toBe(false);
  });
  it("shows setup guidance without creating or enrolling an authenticator", () => {
    render(<Fixture value={{ ...initial, totpConfigs: [] }} />);
    expect(
      screen.getByText(/Configure an authenticator under/),
    ).toBeInTheDocument();
    expect(enable()).toBeDisabled();
    expect(draft().totpConfigs).toEqual([]);
  });
  it("refuses enabling automatic codes when certificate verification is disabled", () => {
    render(<Fixture value={{ ...initial, httpVerifySsl: false }} />);
    choose("Connection authenticator", "Fixture — admin");
    expect(enable()).toBeDisabled();
    expect(
      screen.getByText(/Enable SSL certificate verification in Security/),
    ).toBeInTheDocument();
  });
  it("profile selection disables prior automatic codes and preserves address and credentials", () => {
    render(
      <Fixture
        value={{
          ...initial,
          httpAutoMfa: {
            version: 1,
            enabled: true,
            totpConfigId: "old",
            challengeId: "tacticalrmm-totp",
            origin: "https://rmm.example.test:8443",
          },
        }}
      />,
    );
    choose("Website application", "MeshCentral");
    expect(draft().httpAutoMfa).toEqual({ version: 1, enabled: false });
    expect(draft()).toMatchObject({
      hostname: initial.hostname,
      port: initial.port,
      password: initial.password,
      httpVerifySsl: true,
    });
    expect(
      screen.getByText(/MFA form is not supported for automatic codes/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /Enable automatic codes for this origin/,
      }),
    ).not.toBeInTheDocument();
  });
  it("malformed imported consent requires explicit disable before enabling", () => {
    render(
      <Fixture
        value={{
          ...initial,
          httpAutoMfa: {
            version: 1,
            enabled: true,
          } as Connection["httpAutoMfa"],
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      /automatic 2FA configuration is invalid/,
    );
    expect(enable()).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Disable automatic codes" }),
    );
    expect(draft().httpAutoMfa).toEqual({ version: 1, enabled: false });
  });
});
