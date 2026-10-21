import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Connection } from "../../src/types/connection/connection";

// The editor with declarative login switched on in both engines. The shipped
// flags are off until the engines land; `HTTPDeclarativeLoginOff.test.tsx`
// pins that state.
const steps = vi.hoisted(
  () =>
    (
      id: string,
      evidenceClass: "A" | "B",
      patch: Record<string, unknown> = {},
    ) => ({
      version: 1,
      id,
      evidence: {
        class: evidenceClass,
        source: "https://source.example.test/login.html",
        reviewed: "2026-10-12",
      },
      credentialOrigins: [],
      loginSteps: [
        {
          kind: "form",
          selectors: { username: "#fixture-user", password: "#fixture-pass" },
        },
        {
          kind: "submit",
          submission: "click",
          selectors: { control: "#fixture-go" },
        },
      ],
      ...patch,
    }),
);
vi.mock("../../src/utils/connection/declarativeLoginSupport", () => ({
  DECLARATIVE_LOGIN_SUPPORTED: true,
  DECLARATIVE_LOGIN_LEGACY_SUPPORTED: true,
}));
vi.mock("../../src/utils/connection/httpLoginStepsRegistry", () => ({
  HTTP_LOGIN_STEPS_FILES: [
    ["zulip", steps("zulip", "B")],
    ["uptime-kuma", steps("uptime-kuma", "A")],
    ["idrac", steps("idrac", "B")],
    // Password-only steps: on a device that is on generic detection today
    // (additive) and on one that had no automatic login (exclusive).
    ...["draytek", "eaton-ups"].map((id) => [
      id,
      steps(id, "A", {
        passwordOnly: true,
        loginSteps: [
          { kind: "password", selectors: { password: "#pw" } },
          { kind: "submit", submission: "enter" },
        ],
      }),
    ]),
    // A sign-in form on another, listed origin than the hosted home page.
    [
      "autoridade-tributaria",
      steps("autoridade-tributaria", "B", {
        credentialOrigins: ["https://www.acesso.gov.pt"],
        loginSteps: [
          {
            kind: "form",
            origin: "https://www.acesso.gov.pt",
            paths: ["/v2/loginForm"],
            selectors: { username: "#user", password: "#pass" },
          },
          { kind: "submit", submission: "enter" },
        ],
      }),
    ],
  ],
}));

import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import {
  normalizeImportedAdvancedProtocolConnection,
  prepareConnectionForExport,
} from "../../src/components/ImportExport/advancedProtocolPortability";

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
  sections?: readonly ("application" | "authentication" | "advanced")[];
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
const evidenceNote = () => screen.queryByTestId("login-steps-evidence");

afterEach(cleanup);

describe("steps-based logins in the connection editor", () => {
  it("offers automatic login without internal research notes", () => {
    render(<Fixture />);
    choose("Website application", "Zulip (organization / self-hosted)");
    expect(value().httpApplication).toEqual({
      version: 1,
      id: "zulip",
      loginMode: "manual",
    });
    expect(screen.getByLabelText("Application login mode")).toHaveTextContent(
      manualLabel,
    );
    expect(evidenceNote()).not.toBeInTheDocument();
    expect(
      screen.queryByText(/informed guess|cited source|2026-10-12/i),
    ).not.toBeInTheDocument();
    expect(modes()).toEqual([manualLabel, formLabel]);
    choose("Application login mode", formLabel);
    expect(value().httpApplication).toEqual({
      version: 1,
      id: "zulip",
      loginMode: "form",
    });
    expect(evidenceNote()).not.toBeInTheDocument();
    expect(screen.getByLabelText("Website username")).toHaveValue(
      "fixture-user",
    );
    expect(screen.getByLabelText("Website password")).toHaveValue(
      "fixture-secret",
    );
    // A former manual profile has no single form to override.
    expect(
      screen.queryByText("Selector overrides (optional)"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Manual sign-in only/)).not.toBeInTheDocument();
    expect(resolveHttpApplicationLogin(value())).toMatchObject({
      autoLogin: true,
      declarativeLogin: { source: "catalog", steps: { id: "zulip" } },
    });
  });

  it("offers a reviewed preset without exposing its research metadata", () => {
    render(<Fixture />);
    choose("Website application", "Uptime Kuma (self-hosted)");
    expect(evidenceNote()).not.toBeInTheDocument();
    expect(
      screen.queryByText(/reviewed layout|cited source|2026-10-12/i),
    ).not.toBeInTheDocument();
    expect(modes()).toEqual([manualLabel, formLabel]);
  });

  it("keeps an application without a steps file manual and unannotated", () => {
    render(<Fixture />);
    choose("Website application", "LXD / Incus");
    expect(evidenceNote()).not.toBeInTheDocument();
    expect(modes()).toEqual([manualLabel]);
    cleanup();
    render(<Fixture />);
    choose("Website application", "Portainer");
    expect(evidenceNote()).not.toBeInTheDocument();
    expect(modes()).toHaveLength(4);
  });

  it("presents steps as an addition for an application that already signs in by generic detection", () => {
    render(<Fixture />);
    choose("Website application", "Dell iDRAC");
    // What the profile already does is still what it says it does.
    expect(
      screen.getByText(
        "Optional generic login-form detection; no application-specific browser sign-in has been verified.",
      ),
    ).toBeInTheDocument();
    expect(evidenceNote()).not.toBeInTheDocument();
    expect(modes()).toHaveLength(4);
    choose("Application login mode", formLabel);
    expect(
      screen.getByText(
        /Automatic sign-in first tries the login steps recorded for Dell iDRAC; where they find nothing to act on, generic form detection runs as before\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Selector overrides (optional)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Leave blank for the login steps recorded for Dell iDRAC, with generic detection as the fallback\. Any override skips those steps and uses single-form detection with your selectors\./,
      ),
    ).toBeInTheDocument();
    expect(resolveHttpApplicationLogin(value()).declarativeLogin).toMatchObject(
      { source: "catalog", mode: "additive" },
    );
    fireEvent.change(screen.getByLabelText("Password field selector"), {
      target: { value: "#firmware-specific" },
    });
    const overridden = resolveHttpApplicationLogin(value());
    expect(overridden).not.toHaveProperty("declarativeLogin");
    expect(overridden.selectors).toEqual({
      passwordSelector: "#firmware-specific",
    });
  });

  it("asks only for the password of a password-only device that had no automatic login", () => {
    render(<Fixture />);
    choose("Website application", "Eaton UPS web administration");
    choose("Application login mode", formLabel);
    expect(screen.queryByLabelText("Website username")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Website password")).toHaveValue(
      "fixture-secret",
    );
    expect(
      screen.getByText(/This device signs in with a password only/),
    ).toBeInTheDocument();
    // Generic detection still needs the username where it remains the fallback.
    cleanup();
    render(<Fixture />);
    choose("Website application", "DrayTek");
    choose("Application login mode", formLabel);
    expect(screen.getByLabelText("Website username")).toHaveValue(
      "fixture-user",
    );
    expect(
      screen.queryByText(/This device signs in with a password only/),
    ).not.toBeInTheDocument();
  });

  it("says where the login starts when the connection opens a page without the form", () => {
    render(<Fixture value={{ ...initial, hostname: "" }} />);
    choose(
      "Website application",
      "Autoridade Tributária — Portal das Finanças",
    );
    expect(screen.getByTestId("login-steps-entry")).toHaveTextContent(
      "Automatic sign-in starts on the sign-in page (www.acesso.gov.pt/v2/loginForm), not on the page this connection opens. If the site does not take you there by itself, follow its own sign-in link; the login then fills.",
    );
    // The hosted address is the portal's, as before.
    expect(value()).toMatchObject({
      protocol: "https",
      hostname: "www.portaldasfinancas.gov.pt",
      port: 443,
    });
    cleanup();
    render(<Fixture />);
    choose("Website application", "Zulip (organization / self-hosted)");
    expect(screen.queryByTestId("login-steps-entry")).not.toBeInTheDocument();
  });

  it("points a generic website at the Custom application for frame, password-only and pre-step logins", () => {
    render(<Fixture sections={["authentication"]} />);
    expect(
      screen.getByText(
        /a login form inside a frame, a password-only device or a control to click first/,
      ),
    ).toBeInTheDocument();
  });
});

describe("Custom application: frame, password-only and pre-step fields", () => {
  const selectForm = () => {
    render(<Fixture />);
    choose("Website application", "Custom application");
    choose("Application login mode", formLabel);
  };
  const type = (label: string, text: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value: text } });

  it("writes the three options into the saved profile and round-trips them through export and import", () => {
    selectForm();
    type("Username field selector", "#account");
    type("Password field selector", "#secret");
    type("Submit button selector", "#sign-in");
    // Unset options are not stored.
    expect(value().httpApplication).toEqual({
      version: 1,
      id: "custom",
      loginMode: "form",
    });
    type("Login frame id or name (optional)", "appFrame");
    type("Click before filling (optional)", "#open-login");
    expect(value().httpApplication).toEqual({
      version: 1,
      id: "custom",
      loginMode: "form",
      customLogin: { frame: "appFrame", preStepSelector: "#open-login" },
    });
    expect(
      screen.getByLabelText("Login frame id or name (optional)"),
    ).toHaveAttribute("maxlength", "128");
    expect(resolveHttpApplicationLogin(value()).declarativeLogin).toEqual({
      source: "custom",
      mode: "exclusive",
      steps: {
        passwordOnly: false,
        loginSteps: [
          {
            kind: "click",
            frame: "appFrame",
            selectors: { control: "#open-login" },
          },
          {
            kind: "form",
            frame: "appFrame",
            selectors: { username: "#account", password: "#secret" },
          },
          {
            kind: "submit",
            submission: "click",
            selectors: { control: "#sign-in" },
          },
        ],
      },
    });

    const saved = value() as Connection;
    const imported = normalizeImportedAdvancedProtocolConnection(
      JSON.parse(JSON.stringify(saved)),
    );
    expect(imported.httpApplication).toEqual(saved.httpApplication);
    expect(imported.httpAutoLoginSelectors).toEqual(
      saved.httpAutoLoginSelectors,
    );
    const exported = prepareConnectionForExport(saved, false);
    expect(exported.httpApplication).toEqual(saved.httpApplication);
    expect(JSON.stringify(exported)).not.toContain("fixture-secret");

    // Clearing a field removes it; clearing all removes the object.
    type("Login frame id or name (optional)", "");
    type("Click before filling (optional)", "");
    expect(value().httpApplication).toEqual({
      version: 1,
      id: "custom",
      loginMode: "form",
    });
    expect(resolveHttpApplicationLogin(value())).not.toHaveProperty(
      "declarativeLogin",
    );
  });

  it("accepts only a frame id or name, never a selector or a URL", () => {
    selectForm();
    type("Login frame id or name (optional)", "iframe#app Frame/../x");
    expect(value().httpApplication?.customLogin).toEqual({
      frame: "iframeappFramex",
    });
    expect(value().httpApplication).not.toHaveProperty("invalid");
  });

  it("drops the username selector for a password-only device and the submit selector for Enter", () => {
    selectForm();
    type("Password field selector", "#pin");
    fireEvent.click(
      screen.getByLabelText("Password-only device (no username field)"),
    );
    expect(
      screen.queryByLabelText("Username field selector"),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Website username")).not.toBeInTheDocument();
    choose("Submit with", "Enter key in the password field");
    expect(
      screen.queryByLabelText("Submit button selector"),
    ).not.toBeInTheDocument();
    expect(value().httpApplication).toEqual({
      version: 1,
      id: "custom",
      loginMode: "form",
      customLogin: { passwordOnly: true, submission: "enter" },
    });
    expect(resolveHttpApplicationLogin(value())).toMatchObject({
      credentials: { password: "fixture-secret" },
      autoLogin: true,
      declarativeLogin: {
        source: "custom",
        steps: {
          passwordOnly: true,
          loginSteps: [
            { kind: "password", selectors: { password: "#pin" } },
            { kind: "submit", submission: "enter" },
          ],
        },
      },
    });
    // Back to the defaults: nothing is left in the saved profile.
    fireEvent.click(
      screen.getByLabelText("Password-only device (no username field)"),
    );
    choose("Submit with", "Click on the submit button");
    expect(value().httpApplication).toEqual({
      version: 1,
      id: "custom",
      loginMode: "form",
    });
    expect(screen.getByLabelText("Username field selector")).toBeVisible();
  });

  it("restores saved options on reopen", () => {
    render(
      <Fixture
        value={{
          ...initial,
          httpApplication: {
            version: 1,
            id: "custom",
            loginMode: "form",
            customLogin: {
              frame: "appFrame",
              passwordOnly: true,
              preStepSelector: "#tab2",
              submission: "spa",
            },
          } as Connection["httpApplication"],
          httpAutoLoginSelectors: {
            passwordSelector: "#pin",
            submitSelector: "#go",
          },
        }}
      />,
    );
    expect(
      screen.getByLabelText("Login frame id or name (optional)"),
    ).toHaveValue("appFrame");
    expect(
      screen.getByLabelText("Click before filling (optional)"),
    ).toHaveValue("#tab2");
    expect(
      screen.getByLabelText("Password-only device (no username field)"),
    ).toBeChecked();
    expect(screen.getByLabelText("Submit with")).toHaveTextContent(
      "Click on the button of a script-driven form",
    );
    expect(screen.getByLabelText("Submit button selector")).toHaveValue("#go");
  });
});
