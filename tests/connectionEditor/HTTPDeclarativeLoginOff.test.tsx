import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";

// The shipped state until the engines land: steps files exist, the support
// flags are off. Nothing about a steps-based login may reach the editor.
vi.mock("../../src/utils/connection/declarativeLoginSupport", () => ({
  DECLARATIVE_LOGIN_SUPPORTED: false,
  DECLARATIVE_LOGIN_LEGACY_SUPPORTED: false,
}));
vi.mock("../../src/utils/connection/httpLoginStepsRegistry", () => ({
  HTTP_LOGIN_STEPS_FILES: ["zulip", "idrac"].map((id) => [
    id,
    {
      version: 1,
      id,
      evidence: {
        class: "B",
        source: "https://source.example.test/login.html",
        reviewed: "2026-10-12",
      },
      credentialOrigins: [],
      loginSteps: [
        {
          kind: "form",
          selectors: { username: "#fixture-user", password: "#fixture-pass" },
        },
      ],
    },
  ]),
}));

import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";

const initial: Partial<Connection> = {
  protocol: "https",
  hostname: "fixture.example.test",
  port: 443,
  username: "fixture-user",
  password: "fixture-secret",
};
const manualLabel = "Manual browsing — no saved credentials sent";
const formLabel = "Automatic form login — explicitly opt in";

function Fixture({
  value = initial,
  sections = ["application", "authentication"] as const,
}: {
  value?: Partial<Connection>;
  sections?: readonly ("application" | "advanced")[];
}) {
  const [formData, setFormData] = React.useState(value);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={sections}
      />
      <output data-testid="value">{JSON.stringify(formData)}</output>
    </>
  );
}
const value = () =>
  JSON.parse(screen.getByTestId("value").textContent!) as Partial<Connection>;
function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
function modes() {
  fireEvent.click(screen.getByLabelText("Application login mode"));
  const offered = screen.getAllByRole("option").map((node) => node.textContent);
  fireEvent.click(screen.getByLabelText("Application login mode"));
  return offered;
}

afterEach(cleanup);

describe("steps-based logins while the support flag is off", () => {
  it("keeps a manual application manual, with its description and no evidence note", () => {
    render(<Fixture />);
    choose("Website application", "Zulip (organization / self-hosted)");
    expect(modes()).toEqual([manualLabel]);
    expect(
      screen.queryByTestId("login-steps-evidence"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Manual sign-in only/)).toBeInTheDocument();
    expect(screen.queryByText(/Unverified layout/)).not.toBeInTheDocument();
  });

  it("keeps a generic-detection application on generic detection", () => {
    render(<Fixture />);
    choose("Website application", "Dell iDRAC");
    expect(
      screen.queryByTestId("login-steps-evidence"),
    ).not.toBeInTheDocument();
    expect(modes()).toHaveLength(4);
    choose("Application login mode", formLabel);
    expect(screen.getByText(/Leave blank for/)).toHaveTextContent(
      "Leave blank for generic detection. An unmatched override never falls back to a different field.",
    );
    const login = resolveHttpApplicationLogin(value());
    expect(login).toEqual({
      credentials: { username: "fixture-user", password: "fixture-secret" },
      upstreamAuthMode: "none",
      autoLogin: true,
    });
  });

  it("does not offer the Custom application's frame, password-only and pre-step fields", () => {
    render(<Fixture />);
    choose("Website application", "Custom application");
    choose("Application login mode", formLabel);
    expect(screen.getByLabelText("Username field selector")).toBeVisible();
    for (const label of [
      "Login frame id or name (optional)",
      "Click before filling (optional)",
      "Password-only device (no username field)",
      "Submit with",
    ])
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    cleanup();
    render(<Fixture sections={["advanced"]} />);
    expect(
      screen.queryByText(/a login form inside a frame/),
    ).not.toBeInTheDocument();
  });

  it("lets options saved by a newer build be removed, and never runs them", () => {
    render(
      <Fixture
        value={{
          ...initial,
          httpApplication: {
            version: 1,
            id: "custom",
            loginMode: "form",
            customLogin: { frame: "appFrame", preStepSelector: "#tab2" },
          } as Connection["httpApplication"],
          httpAutoLoginSelectors: {
            usernameSelector: "#account",
            passwordSelector: "#secret",
            submitSelector: "#sign-in",
          },
        }}
      />,
    );
    expect(() => resolveHttpApplicationLogin(value())).toThrow(
      /this build cannot run/,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This custom login was saved with a login frame, password-only, pre-step or submit option that this build cannot run. Automatic login is blocked until the options are removed.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove unsupported login options" }),
    );
    expect(value().httpApplication).toEqual({
      version: 1,
      id: "custom",
      loginMode: "form",
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(resolveHttpApplicationLogin(value())).toMatchObject({
      autoLogin: true,
      selectors: { usernameSelector: "#account" },
    });
  });
});
