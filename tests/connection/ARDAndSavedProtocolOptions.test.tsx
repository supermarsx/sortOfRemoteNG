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
      version: 3,
      authMode: "macOsAccount",
      crossPlatformFallback: {
        enabled: false,
        authMode: "macOsAccount",
      },
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
      screen.queryByLabelText("Fallback remote Mac username"),
    ).not.toBeInTheDocument();
    const accountIdentifier = screen.getByLabelText(
      "Apple Account identifier (saved reference)",
    );
    expect(accountIdentifier).toHaveAttribute("type", "text");
    expect(accountIdentifier).toHaveAttribute("autocomplete", "off");
    fireEvent.change(accountIdentifier, {
      target: { value: "+44 7700 900123" },
    });
    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"appleAccountIdentifier":"+44 7700 900123"',
    );
    expect(
      screen.getByText(
        /never collects, stores, or forwards the Apple Account password/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/two-factor authentication/i)).toBeInTheDocument();
    expect(
      screen.getByText(/removed from credential-free exports/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/encrypted collection/i)).toBeInTheDocument();
    expect(
      screen.getByText(/email address or phone number/i),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("combobox", { name: "Authentication mode" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "Remote Mac account (embedded ARD)",
      }),
    );
    expect(
      screen.queryByLabelText("Apple Account identifier (saved reference)"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("ard-state")).not.toHaveTextContent(
      "appleAccountIdentifier",
    );
  });

  it("configures a distinct portable fallback and clears its credentials when disabled", () => {
    render(<ArdHarness />);

    fireEvent.click(
      screen.getByRole("combobox", { name: "Authentication mode" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "Apple Account via Screen Sharing.app",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Enable cross-platform fallback",
      }),
    );

    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"crossPlatformFallback":{"enabled":true,"authMode":"macOsAccount"}',
    );
    expect(
      screen.getByRole("combobox", { name: "Fallback authentication" }),
    ).toBeInTheDocument();
    const fallbackUsername = screen.getByLabelText(
      "Fallback remote Mac username",
    );
    const fallbackPassword = screen.getByLabelText(
      "Fallback remote Mac password",
    );
    expect(fallbackUsername).toHaveAttribute("autocomplete", "off");
    expect(fallbackPassword).toHaveAttribute("autocomplete", "off");
    fireEvent.change(fallbackUsername, {
      target: { value: "portable-operator" },
    });
    fireEvent.change(fallbackPassword, {
      target: { value: "remote-mac-password" },
    });
    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"username":"portable-operator"',
    );
    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"password":"remote-mac-password"',
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: "Fallback authentication" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "Remote Mac account (embedded ARD)",
      }),
    );
    fireEvent.click(
      screen.getByRole("combobox", { name: "Authentication mode" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "Apple Account via Screen Sharing.app",
      }),
    );
    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"crossPlatformFallback":{"enabled":true,"authMode":"macOsAccount"}',
    );
    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"username":"portable-operator"',
    );
    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"password":"remote-mac-password"',
    );
    expect(
      screen.getByText(/never enter your Apple Account password here/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/if macOS cannot open Screen Sharing/i),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("combobox", { name: "Fallback authentication" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "Legacy VNC password (embedded RFB)",
      }),
    );

    expect(
      screen.queryByLabelText("Fallback remote Mac username"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Fallback VNC server password")).toHaveValue(
      "",
    );
    expect(screen.getByTestId("ard-state")).toHaveTextContent('"username":""');
    expect(screen.getByTestId("ard-state")).toHaveTextContent('"password":""');

    fireEvent.change(screen.getByLabelText("Fallback VNC server password"), {
      target: { value: "dedicated-vnc-password" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Enable cross-platform fallback",
      }),
    );

    expect(
      screen.queryByRole("combobox", { name: "Fallback authentication" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("ard-state")).toHaveTextContent('"username":""');
    expect(screen.getByTestId("ard-state")).toHaveTextContent('"password":""');
    expect(screen.getByTestId("ard-state")).toHaveTextContent(
      '"crossPlatformFallback":{"enabled":false,"authMode":"vncPassword"}',
    );
  });

  it("does not reinterpret a fallback password when changing the primary authentication scheme", () => {
    render(<ArdHarness />);

    fireEvent.click(
      screen.getByRole("combobox", { name: "Authentication mode" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "Apple Account via Screen Sharing.app",
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Enable cross-platform fallback",
      }),
    );
    fireEvent.change(screen.getByLabelText("Fallback remote Mac password"), {
      target: { value: "fallback-only-password" },
    });

    fireEvent.click(
      screen.getByRole("combobox", { name: "Authentication mode" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: "Remote Mac account (embedded ARD)",
      }),
    );

    expect(screen.getByLabelText("Remote Mac password")).toHaveValue("");
    expect(screen.getByTestId("ard-state")).toHaveTextContent('"password":""');
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

  it("keeps SPICE TLS settings coherent and exposes only enforceable trust controls", () => {
    render(
      <SavedHarness
        initial={{ protocol: "spice", isGroup: false }}
        section="security"
      />,
    );

    expect(
      screen.queryByLabelText(/allow an unverified certificate/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("CA certificate path (optional)"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /require a tls spice transport/i }),
    );

    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"spiceRequireTls":true',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"spiceTlsPort":5901',
    );
    expect(
      screen.getByLabelText("CA certificate path (optional)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /unverified spice certificates are intentionally unsupported/i,
      ),
    ).toBeInTheDocument();
  });

  it("passes a saved SPICE ticket by the protocol-owned field and does not offer clipboard-off", () => {
    const { rerender } = render(
      <SavedHarness
        initial={{ protocol: "spice", isGroup: false }}
        section="authentication"
      />,
    );
    fireEvent.change(screen.getByLabelText("SPICE ticket (optional)"), {
      target: { value: "temporary-ticket" },
    });
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"password":"temporary-ticket"',
    );
    expect(
      screen.getByText(/standard input connection file/i),
    ).toBeInTheDocument();

    rerender(
      <SavedHarness
        initial={{ protocol: "spice", isGroup: false }}
        section="display-input"
      />,
    );
    expect(
      screen.queryByRole("checkbox", { name: /clipboard/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/clipboard follows remote-viewer's supported default/i),
    ).toBeInTheDocument();
  });

  it("requires an explicit XDMCP plaintext-risk acknowledgement", () => {
    render(
      <SavedHarness
        initial={{ protocol: "xdmcp", isGroup: false }}
        section="security"
      />,
    );

    expect(
      screen.getByText(/xdmcp is unauthenticated and unencrypted/i),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /understand and accept the xdmcp transport risk/i,
      }),
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"xdmcpAcknowledgeInsecureTransport":true',
    );
  });

  it("keeps XDMCP on its enforceable 24-bit native-display default", () => {
    render(
      <SavedHarness
        initial={{ protocol: "xdmcp", isGroup: false }}
        section="display-input"
      />,
    );

    expect(
      screen.queryByRole("combobox", { name: /color depth/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/supported 24-bit display default/i),
    ).toBeInTheDocument();
  });

  it("configures X2Go native authentication without collecting a password or passphrase", () => {
    render(
      <SavedHarness
        initial={{ protocol: "x2go", isGroup: false }}
        section="authentication"
      />,
    );

    expect(screen.queryByLabelText(/^Password$/i)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("combobox", { name: "SSH authentication" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Private key or key path" }),
    );
    fireEvent.change(screen.getByLabelText("Private key or local key path"), {
      target: { value: "C:\\Users\\me\\.ssh\\id_ed25519" },
    });

    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"x2goAuthMode":"privateKey"',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"privateKey":"C:\\\\Users\\\\me\\\\.ssh\\\\id_ed25519"',
    );
    expect(screen.queryByLabelText(/passphrase/i)).not.toBeInTheDocument();
  });

  it("serializes X2Go shared folders as local auto-mount paths only", () => {
    render(
      <SavedHarness
        initial={{ protocol: "x2go", isGroup: false }}
        section="resources"
      />,
    );

    fireEvent.change(
      screen.getByLabelText("Shared local folders (one path per line)"),
      { target: { value: "C:\\Work\nC:\\Logs\nC:\\Work" } },
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"remote_name":""',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"auto_mount":true',
    );
    expect(
      screen.getByTestId("saved-state").textContent?.match(/local_path/g),
    ).toHaveLength(2);
  });

  it("switches NoMachine transport defaults without exposing unsupported clipboard disable", () => {
    const { rerender } = render(
      <SavedHarness
        initial={{ protocol: "nx", port: 4000, isGroup: false }}
        section="connection"
      />,
    );

    fireEvent.click(
      screen.getByRole("combobox", { name: "NoMachine transport" }),
    );
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "NoMachine over SSH (port 22)" }),
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent(
      '"nxConnectionService":"ssh"',
    );
    expect(screen.getByTestId("saved-state")).toHaveTextContent('"port":22');

    rerender(
      <SavedHarness
        initial={{ protocol: "nx", isGroup: false }}
        section="display-input"
      />,
    );
    expect(
      screen.queryByRole("checkbox", { name: /clipboard/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/clipboard is left enabled/i)).toBeInTheDocument();
  });
});
