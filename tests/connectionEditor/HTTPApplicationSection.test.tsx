import React from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";

const initial: Partial<Connection> = {
  protocol: "https",
  hostname: "fixture.example.test",
  port: 9443,
  username: "old-user",
  password: "old-secret",
  httpVerifySsl: false,
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
      <output data-testid="value">{JSON.stringify(formData)}</output>
    </>
  );
}
function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
const value = () =>
  JSON.parse(screen.getByTestId("value").textContent!) as Partial<Connection>;

describe("HTTP Application subtab", () => {
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
