import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ARDOptions from "../../src/components/connectionEditor/ARDOptions";
import SavedProtocolOptions, {
  type SavedProtocolOptionsSection,
} from "../../src/components/connectionEditor/SavedProtocolOptions";
import type { Connection } from "../../src/types/connection/connection";

const ArdHarness = () => {
  const [formData, setFormData] = useState<Partial<Connection>>({
    protocol: "ard",
    isGroup: false,
    username: "remote-mac-user",
    password: "embedded-ard-secret",
    ardSettings: {
      version: 1,
      authMode: "macOsAccount",
      autoReconnect: true,
      curtainOnConnect: false,
      localCursor: true,
      viewOnly: false,
    },
  });

  return (
    <>
      <ARDOptions formData={formData} setFormData={setFormData} />
      <output data-testid="ard-state">{JSON.stringify(formData)}</output>
    </>
  );
};

const SavedHarness: React.FC<{
  initial: Partial<Connection>;
  section: SavedProtocolOptionsSection;
}> = ({ initial, section }) => {
  const [formData, setFormData] = useState<Partial<Connection>>(initial);
  return (
    <>
      <SavedProtocolOptions
        formData={formData}
        setFormData={setFormData}
        section={section}
      />
      <output data-testid="saved-state">{JSON.stringify(formData)}</output>
    </>
  );
};

describe("ARDOptions", () => {
  it("hands Apple Account authentication to Screen Sharing without retaining an embedded secret", () => {
    render(<ArdHarness />);

    expect(screen.getByLabelText("Remote Mac username")).toHaveValue(
      "remote-mac-user",
    );
    expect(document.querySelector("#ard-password")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("combobox", { name: "Authentication mode" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "Apple Account via Screen Sharing.app",
      }),
    );

    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"authMode":"appleAccountNative"',
    );
    expect(screen.getByTestId("ard-state")).toHaveTextContent('"username":""');
    expect(screen.getByTestId("ard-state")).toHaveTextContent('"password":""');
    expect(document.querySelector("#ard-password")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /does not collect, store, or send an Apple Account password/i,
      ),
    ).toBeInTheDocument();
  });

  it("persists embedded display and input options independently", () => {
    render(<ArdHarness />);

    fireEvent.click(screen.getByLabelText("View only"));
    fireEvent.click(screen.getByLabelText("Enable curtain mode on connect"));

    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"viewOnly":true',
    );
    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"curtainOnConnect":true',
    );
  });
});

describe("SavedProtocolOptions", () => {
  it("switches SFTP between password and private-key authentication fields", () => {
    render(
      <SavedHarness
        initial={{ protocol: "sftp", authType: "password", isGroup: false }}
        section="authentication"
      />,
    );

    expect(document.querySelector("#sftp-password")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("combobox", { name: "SFTP authentication" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Username and private key" }),
    );

    expect(document.querySelector("#sftp-password")).not.toBeInTheDocument();
    expect(document.querySelector("#sftp-private-key")).toBeInTheDocument();
    expect(document.querySelector("#sftp-passphrase")).toBeInTheDocument();
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"authType":"key"',
    );
  });

  it("keeps the RustDesk device ID as the launch target", () => {
    render(
      <SavedHarness
        initial={{ protocol: "rustdesk", isGroup: false }}
        section="connection"
      />,
    );

    fireEvent.change(screen.getByLabelText("Remote device ID"), {
      target: { value: "123 456 789" },
    });

    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"rustdeskId":"123 456 789"',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"hostname":"123 456 789"',
    );
  });
});
