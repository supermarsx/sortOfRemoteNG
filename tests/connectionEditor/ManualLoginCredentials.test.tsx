import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HTTPOptions } from "../../src/components/connectionEditor/HTTPOptions";
import type { Connection } from "../../src/types/connection/connection";
import { resolveHttpApplicationLogin } from "../../src/utils/auth/httpApplicationLogin";
import { selectSavedCredentialPair } from "../../src/utils/auth/httpCredentials";

// User request: "even with manual login we need to allow setting user and
// password to be allowed to type to field". A manual profile signs in nothing
// by itself, but the saved pair stays editable so the open tab's Credentials
// panel can type it into the focused field on request.
const base: Partial<Connection> = {
  protocol: "https",
  hostname: "portal.example.test",
  port: 443,
  username: "connection-user",
  password: "connection-secret",
};

function Fixture({ initial }: { initial: Partial<Connection> }) {
  const [formData, setFormData] = React.useState(initial);
  return (
    <>
      <HTTPOptions
        formData={formData}
        setFormData={setFormData}
        sections={["application", "authentication"]}
      />
      <output data-testid="draft">{JSON.stringify(formData)}</output>
    </>
  );
}
const draft = () =>
  JSON.parse(screen.getByTestId("draft").textContent!) as Partial<Connection>;
function choose(label: string, option: string | RegExp) {
  fireEvent.click(screen.getByLabelText(label));
  fireEvent.mouseDown(screen.getByRole("option", { name: option }));
}
const manual = (id: string): Partial<Connection> => ({
  ...base,
  httpApplication: { version: 1, id, loginMode: "manual" },
});

describe("manual sign-in keeps the saved website credentials editable", () => {
  it.each([
    // Manual-only profiles (no automatic sign-in in this build).
    ["meo-particulares", "Website username"],
    ["vodafone-portugal", "Website username"],
    // A profile that also offers automatic login, left on manual.
    ["opnsense", "Website webgui username"],
  ])(
    "%s on manual shows enabled username and password fields",
    (id, userLabel) => {
      render(<Fixture initial={manual(id)} />);
      const user = screen.getByLabelText(userLabel);
      const password = screen.getByLabelText("Website password");
      expect(user).toBeEnabled();
      expect(password).toBeEnabled();
      fireEvent.change(user, { target: { value: "typed-user" } });
      fireEvent.change(screen.getByLabelText("Website password"), {
        target: { value: "typed-secret" },
      });
      const saved = draft();
      expect(saved.httpApplication).toMatchObject({ id, loginMode: "manual" });
      expect(saved.basicAuthUsername).toBe("typed-user");
      expect(saved.basicAuthPassword).toBe("typed-secret");
      // The pair the Credentials panel types is exactly this one...
      expect(selectSavedCredentialPair(saved, true)).toMatchObject({
        username: "typed-user",
        password: "typed-secret",
      });
      // ...and manual still sends nothing by itself.
      expect(resolveHttpApplicationLogin(saved)).toMatchObject({
        credentials: null,
        autoLogin: false,
        upstreamAuthMode: "none",
      });
    },
  );

  it("says the saved pair is typed only on request, never sent by itself", () => {
    render(<Fixture initial={manual("meo-particulares")} />);
    const note = screen.getByTestId("manual-login-credentials-note");
    expect(note).toHaveTextContent(
      /never sends or types these credentials on its own/i,
    );
    expect(note).toHaveTextContent(/Credentials & 2FA/);
    expect(note).toHaveTextContent(/Type username/);
    expect(screen.queryByText(/for this automatic login/)).toBeNull();
  });

  it("keeps the pair when switching between automatic and manual login", () => {
    render(
      <Fixture
        initial={{
          ...base,
          basicAuthUsername: "saved-user",
          basicAuthPassword: "saved-secret",
          httpApplication: { version: 1, id: "opnsense", loginMode: "form" },
        }}
      />,
    );
    choose("Application login mode", /^Manual browsing/);
    expect(draft().httpApplication?.loginMode).toBe("manual");
    expect(screen.getByLabelText("Website webgui username")).toHaveValue(
      "saved-user",
    );
    expect(screen.getByLabelText("Website password")).toHaveValue(
      "saved-secret",
    );
    expect(
      screen.queryByTestId("manual-login-credentials-note"),
    ).toBeInTheDocument();
    choose("Application login mode", /^Automatic form login/);
    expect(
      screen.queryByTestId("manual-login-credentials-note"),
    ).not.toBeInTheDocument();
    expect(draft()).toMatchObject({
      basicAuthUsername: "saved-user",
      basicAuthPassword: "saved-secret",
    });
  });

  it("a database vault credential stays locked here on manual too", () => {
    render(
      <Fixture
        initial={{
          ...manual("meo-particulares"),
          credentialSource: {
            kind: "vault",
            credentialId: "01234567-89ab-4cde-8fab-0123456789ab",
          },
        }}
      />,
    );
    expect(screen.getByLabelText("Website username")).toBeDisabled();
    expect(screen.getByLabelText("Website password")).toBeDisabled();
  });

  it("an invalid profile still hides the fields", () => {
    render(
      <Fixture
        initial={{
          ...base,
          httpApplication: {
            version: 1,
            id: "meo-particulares",
            loginMode: "basic",
          },
        }}
      />,
    );
    expect(screen.queryByLabelText("Website password")).toBeNull();
  });
});
