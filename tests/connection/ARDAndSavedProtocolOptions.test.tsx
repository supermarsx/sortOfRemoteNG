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

  it("persists only supported passive FTP connection settings", () => {
    render(
      <SavedHarness
        initial={{ protocol: "ftp", isGroup: false }}
        section="connection"
      />,
    );

    fireEvent.change(screen.getByLabelText("Initial remote directory"), {
      target: { value: "/incoming" },
    });
    fireEvent.click(
      screen.getByRole("combobox", { name: "Data connection mode" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Extended passive (EPSV)" }),
    );

    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"remotePath":"/incoming"',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"ftpDataChannelMode":"extendedPassive"',
    );
    expect(screen.queryByText(/active \(port/i)).not.toBeInTheDocument();
  });

  it("persists FTPS trust controls without hiding the unsafe state", () => {
    render(
      <SavedHarness
        initial={{ protocol: "ftp", isGroup: false }}
        section="security"
      />,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: "Transport security" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Explicit FTPS (AUTH TLS)" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /accept invalid tls certificates/i,
      }),
    );

    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"ftpSecurity":"explicit"',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"ftpAcceptInvalidCerts":true',
    );
    expect(
      screen.getByText(/machine-in-the-middle can impersonate/i),
    ).toBeInTheDocument();
  });

  it("configures SCP key authentication with distinct saved fields", () => {
    render(
      <SavedHarness
        initial={{ protocol: "scp", authType: "password", isGroup: false }}
        section="authentication"
      />,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: "SCP authentication" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Username and private key" }),
    );

    expect(document.querySelector("#scp-password")).not.toBeInTheDocument();
    expect(document.querySelector("#scp-private-key")).toBeInTheDocument();
    expect(document.querySelector("#scp-passphrase")).toBeInTheDocument();
  });

  it("persists SCP host-key policy and the honored known_hosts path", () => {
    render(
      <SavedHarness
        initial={{ protocol: "scp", isGroup: false }}
        section="security"
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Host-key policy" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Strict (known hosts only)" }),
    );
    fireEvent.change(screen.getByLabelText("Known hosts file (optional)"), {
      target: { value: "C:\\keys\\scp_known_hosts" },
    });

    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"sshTrustPolicy":"strict"',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"sshKnownHostsPath":"C:\\\\keys\\\\scp_known_hosts"',
    );
    expect(
      screen.getByText(
        /does not yet provide an interactive fingerprint prompt/i,
      ),
    ).toBeInTheDocument();
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

  it("persists PostgreSQL database credentials only in protocol-owned fields", () => {
    const { rerender } = render(
      <SavedHarness
        initial={{ protocol: "postgresql", isGroup: false }}
        section="connection"
      />,
    );

    fireEvent.change(screen.getByLabelText("Default database"), {
      target: { value: "analytics" },
    });
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"database":"analytics"',
    );

    rerender(
      <SavedHarness
        initial={{ protocol: "postgresql", isGroup: false }}
        section="authentication"
      />,
    );
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "report_reader" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "postgres-secret" },
    });
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"username":"report_reader"',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"password":"postgres-secret"',
    );
  });

  it("persists PostgreSQL SSL and timeout settings with truthful direct-route copy", () => {
    const { rerender } = render(
      <SavedHarness
        initial={{ protocol: "postgresql", isGroup: false }}
        section="security"
      />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "SSL mode" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Verify CA and hostname" }),
    );
    fireEvent.change(screen.getByLabelText("CA certificate path"), {
      target: { value: "C:\\certs\\postgres-root.pem" },
    });
    fireEvent.change(screen.getByLabelText("Client certificate path"), {
      target: { value: "C:\\certs\\client.pem" },
    });
    fireEvent.change(screen.getByLabelText("Client key path"), {
      target: { value: "C:\\certs\\client-key.pem" },
    });

    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"postgresSslMode":"verify-full"',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"postgresCaCertificatePath":"C:\\\\certs\\\\postgres-root.pem"',
    );

    rerender(
      <SavedHarness
        initial={{ protocol: "postgresql", isGroup: false }}
        section="advanced"
      />,
    );
    fireEvent.change(screen.getByLabelText("Connect timeout (seconds)"), {
      target: { value: "25" },
    });
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"postgresConnectionTimeoutSecs":25',
    );
    expect(
      screen.getByText(/rejected before credentials are sent/i),
    ).toBeInTheDocument();
  });
});
