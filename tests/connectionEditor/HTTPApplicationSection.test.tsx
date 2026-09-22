import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import type { DatabaseCredentialVaultApi } from "../../src/types/security/databaseCredentialVault";
import { ConnectionContext } from "../../src/contexts/ConnectionContextTypes";

const vaultCredentialId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const initial: Partial<Connection> = {
  protocol: "https",
  hostname: "fixture.example.test",
  port: 9443,
  username: "old-user",
  password: "old-secret",
  httpVerifySsl: false,
};
function databaseVaultApi(): DatabaseCredentialVaultApi {
  return {
    scope: { databaseId: "owner", generation: 1 },
    changeRevision: 1,
    list: async () => ({
      scope: { databaseId: "owner", generation: 1 },
      revision: 1,
      receipt: "read",
      entries: [
        {
          id: vaultCredentialId,
          name: "Application vault credential",
          createdAt: "2026-09-20",
          updatedAt: "2026-09-20",
          availableFacets: ["username", "password", "totp"],
        },
      ],
    }),
    resolve: async () => ({
      totp: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          label: "Application authenticator",
          secret: "VAULT_SECRET_MUST_NOT_APPEAR",
          algorithm: "sha1",
          digits: 6,
          period: 30,
        },
      ],
    }),
    compareAndSwap: async () => {},
  };
}
function Fixture({ value = initial }: { value?: Partial<Connection> }) {
  const [formData, setFormData] = React.useState(value);
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
function VaultFixture({ value }: { value: Partial<Connection> }) {
  const api = React.useMemo(databaseVaultApi, []);
  return (
    <ConnectionContext.Provider
      value={
        { credentialVault: api } as React.ContextType<typeof ConnectionContext>
      }
    >
      <Fixture value={value} />
    </ConnectionContext.Provider>
  );
}
function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
const value = () =>
  JSON.parse(screen.getByTestId("value").textContent!) as Partial<Connection>;

describe("HTTP Application subtab", () => {
  it("applies Google's built-in authority to a blank record without overwriting a custom destination", () => {
    const { unmount } = render(
      <Fixture
        value={{
          protocol: "http",
          hostname: "",
          port: 80,
          httpVerifySsl: false,
        }}
      />,
    );
    choose("Website application", "Google Drive");
    expect(value()).toMatchObject({
      protocol: "https",
      hostname: "drive.google.com",
      port: 443,
      httpVerifySsl: false,
      httpApplication: { version: 1, id: "gdrive", loginMode: "manual" },
    });
    unmount();

    render(<Fixture />);
    choose("Website application", "Google Cloud Console");
    expect(value()).toMatchObject({
      ...initial,
      httpApplication: {
        version: 1,
        id: "google-cloud-console",
        loginMode: "manual",
      },
    });
  });

  it("replaces a previously managed Google authority when switching profiles", () => {
    render(
      <Fixture
        value={{
          protocol: "http",
          hostname: "mail.google.com",
          port: 80,
          httpApplication: {
            version: 1,
            id: "gmail",
            loginMode: "manual",
          },
        }}
      />,
    );
    choose("Website application", "Google Cloud Console");
    expect(value()).toMatchObject({
      protocol: "https",
      hostname: "console.cloud.google.com",
      port: 443,
      httpApplication: {
        version: 1,
        id: "google-cloud-console",
        loginMode: "manual",
      },
    });
  });

  it("edits and clears only the Tactical API origin without changing login or authority", () => {
    render(<Fixture />);
    expect(
      screen.queryByLabelText("Tactical RMM API origin (optional)"),
    ).not.toBeInTheDocument();
    choose("Website application", "Tactical RMM");
    const api = screen.getByLabelText("Tactical RMM API origin (optional)");
    expect(api).toHaveAttribute("placeholder", "https://api.example.com");
    expect(
      screen.getByText(/Blank keeps default API routing/),
    ).toBeInTheDocument();
    fireEvent.change(api, {
      target: { value: "http://api.example.com/private" },
    });
    expect(api).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/Enter an HTTPS origin such as/),
    ).toBeInTheDocument();
    fireEvent.change(api, {
      target: { value: "https://API.example.com:443/" },
    });
    fireEvent.blur(api);
    expect(api).toHaveValue("https://api.example.com");
    expect(api).toHaveAttribute("aria-invalid", "false");
    expect(value()).toMatchObject({
      ...initial,
      httpApplication: {
        version: 1,
        id: "tacticalrmm",
        loginMode: "manual",
        apiOrigin: "https://api.example.com",
      },
      httpAutoLogin: false,
      httpAutoMfa: { version: 1, enabled: false },
    });
    fireEvent.change(api, { target: { value: "" } });
    expect(value().httpApplication?.apiOrigin).toBeUndefined();
    expect(api).toHaveAttribute("aria-invalid", "false");
    fireEvent.change(api, { target: { value: "https://api.example.com" } });
    choose("Website application", "Joomla Administrator");
    expect(
      screen.queryByLabelText("Tactical RMM API origin (optional)"),
    ).not.toBeInTheDocument();
    expect(value().httpApplication?.apiOrigin).toBeUndefined();
  });

  it("shows an invalid imported Tactical origin and permits correcting the address", () => {
    render(
      <Fixture
        value={{
          ...initial,
          httpApplication: {
            version: 1,
            id: "tacticalrmm",
            loginMode: "manual",
            apiOrigin: "https://api.example.com/accounts/",
          },
        }}
      />,
    );
    const api = screen.getByLabelText("Tactical RMM API origin (optional)");
    expect(api).toHaveValue("https://api.example.com/accounts/");
    expect(api).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(api, { target: { value: "https://api.example.com" } });
    expect(
      screen.queryByText(/This imported application profile is invalid/),
    ).not.toBeInTheDocument();
    expect(value().httpApplication?.loginMode).toBe("manual");
  });

  it("selects Joomla versions without changing path, overrides, authority or consent", () => {
    render(
      <Fixture
        value={{
          ...initial,
          httpApplication: {
            version: 1,
            id: "joomla",
            loginMode: "manual",
            loginPath: "/staff-entry/",
          },
          httpAutoLoginSelectors: { submitSelector: "#custom" },
        }}
      />,
    );
    expect(screen.getByLabelText("Joomla version")).toHaveTextContent(
      "Auto-detect",
    );
    for (const version of ["3", "4", "5", "6"]) {
      choose(
        "Joomla version",
        version === "3"
          ? "Joomla 3 — legacy administrator"
          : `Joomla ${version} — administrator`,
      );
      expect(value()).toMatchObject({
        ...initial,
        httpApplication: {
          version: 1,
          id: "joomla",
          loginMode: "manual",
          loginPath: "/staff-entry/",
          joomlaVersion: version,
        },
        httpAutoLoginSelectors: { submitSelector: "#custom" },
      });
      expect(value().httpAutoMfa?.enabled).not.toBe(true);
    }
    expect(
      screen.getByText(/Joomla 3 and 4.0–4.1 can request/),
    ).toHaveTextContent(/submission pauses/);
    expect(
      screen.getByText(/Joomla 3 and 4.0–4.1 can request/),
    ).toHaveTextContent(/4.2\+, 5 and 6 use a separate/);
  });
  it("edits Joomla's administrator entry path without changing authority or granting login", () => {
    render(<Fixture />);
    choose("Website application", "Joomla Administrator");
    const path = screen.getByLabelText("Administrator path");
    expect(path).toHaveAttribute("placeholder", "/administrator/");
    fireEvent.change(path, { target: { value: "/portal/staff-entry/" } });
    expect(value()).toMatchObject({
      ...initial,
      httpApplication: {
        version: 1,
        id: "joomla",
        loginMode: "manual",
        loginPath: "/portal/staff-entry/",
      },
    });
    fireEvent.change(path, {
      target: { value: "https://other.test/?secret=x" },
    });
    expect(
      screen.getByText(/Enter a path beginning with one slash/),
    ).toBeInTheDocument();
    fireEvent.change(path, { target: { value: "" } });
    expect(value().httpApplication?.loginPath).toBeUndefined();
    expect(
      screen.queryByText(/Enter a path beginning with one slash/),
    ).not.toBeInTheDocument();
  });
  it("offers Cloudflare in networking with manual 2FA guidance and an explicit address action only", () => {
    render(<Fixture />);
    choose("Application category", "Networking / proxies");
    choose("Website application", "Cloudflare Dashboard");
    expect(value()).toMatchObject({
      ...initial,
      httpApplication: { version: 1, id: "cloudflare", loginMode: "manual" },
    });
    expect(screen.queryByLabelText("Website password")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Embedded sign-in and challenge compatibility/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Application login mode"));
    expect(
      screen.getByRole("option", { name: /Manual browsing/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Automatic form/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "HTTP Basic authentication" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(
      screen.getByRole("button", { name: "Use Cloudflare Dashboard address" }),
    );
    expect(value()).toMatchObject({
      ...initial,
      protocol: "https",
      hostname: "dash.cloudflare.com",
      port: 443,
    });
    expect(value().password).toBe(initial.password);
    expect(value().httpVerifySsl).toBe(initial.httpVerifySsl);
  });
  it("selects manually without changing authority, TLS, or saved credentials", () => {
    render(
      <Fixture
        value={{
          ...initial,
          httpAutoLogin: true,
          httpAutoLoginSelectors: { usernameSelector: "#old" },
        }}
      />,
    );
    choose("Website application", "Portainer");
    expect(value()).toMatchObject({
      ...initial,
      httpApplication: { version: 1, id: "portainer", loginMode: "manual" },
      httpAutoLogin: false,
    });
    expect(value().httpAutoLoginSelectors).toBeUndefined();
    expect(screen.queryByLabelText("Website password")).not.toBeInTheDocument();
  });
  it("filters compact categories while All applications provides global search", () => {
    render(<Fixture />);
    choose("Application category", "Server management / BMC");
    fireEvent.click(screen.getByLabelText("Website application"));
    expect(
      screen.getByRole("option", { name: "HP / HPE iLO" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Portainer" }),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    choose("Application category", "All website applications");
    fireEvent.click(screen.getByLabelText("Website application"));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search all website applications…" }),
      { target: { value: "proxy manager" } },
    );
    expect(
      screen.getByRole("option", { name: "Nginx Proxy Manager" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Portainer" }),
    ).not.toBeInTheDocument();
  });
  it("keeps native-only entries separate, disabled, and explains the limitation", () => {
    render(<Fixture />);
    choose("Application category", "Native integration only");
    expect(
      screen.getByText(/cannot be selected as browser profiles/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Website application"));
    expect(
      screen.getByRole("option", { name: "Microsoft SQL Server" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.queryByRole("option", { name: "Grafana" }),
    ).not.toBeInTheDocument();
  });
  it("shows reviewed form fields only after explicit opt-in and preserves paired credentials", () => {
    render(<Fixture />);
    choose("Website application", "Nginx Proxy Manager");
    choose(
      "Application login mode",
      "Automatic form login — explicitly opt in",
    );
    expect(screen.getByLabelText("Website email")).toHaveValue("old-user");
    fireEvent.change(screen.getByLabelText("Website email"), {
      target: { value: "admin@example.test" },
    });
    expect(value()).toMatchObject({
      basicAuthUsername: "admin@example.test",
      basicAuthPassword: "old-secret",
      username: "old-user",
      password: "old-secret",
    });
    expect(screen.getByText(/No preemptive Basic header/)).toBeInTheDocument();
  });
  it("chooses a vault explicitly, locks its fields, and disarms automatic MFA", async () => {
    render(
      <VaultFixture
        value={{
          ...initial,
          httpApplication: {
            version: 1,
            id: "wordpress",
            loginMode: "form",
          },
          totpConfigs: [
            {
              id: "local-authenticator",
              account: "Local account",
              issuer: "Local",
              secret: "LOCAL_SECRET",
              algorithm: "sha1",
              digits: 6,
              period: 30,
            },
          ],
          httpAutoMfa: {
            version: 1,
            enabled: true,
            totpConfigId: "local-authenticator",
            challengeId: "wordpress-two-factor-totp",
            origin: "https://fixture.example.test:9443",
          },
        }}
      />,
    );
    expect(screen.getByText("Website credential source")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Database vault" }));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Reusable vault credential" }),
      ).toBeEnabled(),
    );
    choose(
      "Reusable vault credential",
      "Application vault credential · Username, Password, TOTP authenticators",
    );
    expect(value().credentialSource).toEqual({
      kind: "vault",
      credentialId: vaultCredentialId,
    });
    expect(value().httpAutoMfa).toEqual({ version: 1, enabled: false });
    expect(screen.getByLabelText("Website username or email")).toBeDisabled();
    expect(screen.getByLabelText("Website password")).toBeDisabled();
    expect(
      screen.getByText(/Website username and password fields are locked here/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Vault authenticator")).toBeInTheDocument();
    expect(JSON.stringify(value())).not.toContain(
      "VAULT_SECRET_MUST_NOT_APPEAR",
    );
  });
  it("restores editable connection-local fields only after switching sources", () => {
    render(
      <Fixture
        value={{
          ...initial,
          basicAuthUsername: "local-user",
          basicAuthPassword: "local-password",
          httpApplication: {
            version: 1,
            id: "wordpress",
            loginMode: "form",
          },
          credentialSource: {
            kind: "vault",
            credentialId: vaultCredentialId,
          },
          httpAutoMfa: {
            version: 1,
            enabled: true,
            totpConfigId: "vault-authenticator",
            challengeId: "wordpress-two-factor-totp",
            origin: "https://fixture.example.test:9443",
          },
        }}
      />,
    );
    expect(screen.getByLabelText("Website username or email")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Connection-local" }));
    expect(value().credentialSource).toEqual({ kind: "local" });
    expect(value().httpAutoMfa).toEqual({ version: 1, enabled: false });
    expect(screen.getByLabelText("Website username or email")).toBeEnabled();
    expect(screen.getByLabelText("Website username or email")).toHaveValue(
      "local-user",
    );
    expect(screen.getByLabelText("Website password")).toHaveValue(
      "local-password",
    );
  });
  it("exposes Proxmox realm without changing saved username and explains generic iLO", () => {
    render(<Fixture />);
    choose("Website application", "Proxmox VE");
    choose(
      "Application login mode",
      "Automatic form login — explicitly opt in",
    );
    fireEvent.change(screen.getByLabelText("Account realm"), {
      target: { value: "pve" },
    });
    expect(value().username).toBe("old-user");
    expect(value().httpApplication?.realm).toBe("pve");
    choose("Website application", "HP / HPE iLO");
    expect(screen.getByText(/firmware-dependent/)).toBeInTheDocument();
    expect(value().httpApplication?.loginMode).toBe("manual");
  });
  it("keeps malformed imported metadata blocked and generic restores legacy controls", () => {
    render(
      <Fixture
        value={{
          ...initial,
          httpApplication: null as unknown as Connection["httpApplication"],
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Connecting is blocked",
    );
    choose("Website application", "Generic website — existing HTTP settings");
    expect(value().httpApplication).toBeUndefined();
    expect(value().password).toBe("old-secret");
    expect(
      screen.getByText(/existing Authentication and Advanced/),
    ).toBeInTheDocument();
  });
});
