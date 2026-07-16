import React, { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConnectionEditorMgr } from "../../../hooks/connection/useConnectionEditor";
import type { Connection } from "../../../types/connection/connection";
import { ProtocolSections } from "./ProtocolSections";
import { getProtocolSubtabs, type ProtocolSubtabId } from "./protocolSubtabs";

vi.mock("../../connectionEditor/RDPOptions", () => ({
  default: ({ formData, setFormData, sections }: any) => (
    <div data-testid="rdp-options" data-sections={sections?.join(",") ?? "all"}>
      RDP: {sections?.join(",") ?? "all"}
      {sections?.includes("connection") && (
        <label>
          Mock RDP domain
          <input
            aria-label="Mock RDP domain"
            value={formData.domain ?? ""}
            onChange={(event) =>
              setFormData((previous: Partial<Connection>) => ({
                ...previous,
                domain: event.target.value,
              }))
            }
          />
        </label>
      )}
    </div>
  ),
}));

vi.mock("../../connectionEditor/SSHOptions", () => ({
  default: ({ sections }: any) => (
    <div data-testid="ssh-options" data-sections={sections?.join(",") ?? "all"}>
      SSH: {sections?.join(",") ?? "all"}
    </div>
  ),
}));

vi.mock("../../connectionEditor/HTTPOptions", () => ({
  default: ({ sections }: any) => (
    <div
      data-testid="http-options"
      data-sections={sections?.join(",") ?? "all"}
    >
      HTTP: {sections?.join(",") ?? "all"}
    </div>
  ),
}));

vi.mock("../../connectionEditor/WinRMOptions", () => ({
  default: ({ sections }: any) => (
    <div
      data-testid="winrm-options"
      data-sections={sections?.join(",") ?? "all"}
    >
      WinRM: {sections?.join(",") ?? "all"}
    </div>
  ),
}));

vi.mock("../../connectionEditor/rawSocket/RawSocketOptions", () => ({
  default: ({ sections }: any) => (
    <div data-testid="raw-options" data-sections={sections?.join(",") ?? "all"}>
      Raw: {sections?.join(",") ?? "all"}
    </div>
  ),
}));

vi.mock("../../connectionEditor/RloginOptions", () => ({
  default: ({ section }: any) => (
    <div data-testid="rlogin-options" data-section={section}>
      RLogin: {section}
    </div>
  ),
}));

vi.mock(
  "../../connectionEditor/powerShellRemoting/PowerShellRemotingEditor",
  () => ({
    PowerShellRemotingEditor: ({ sections }: any) => (
      <div
        data-testid="powershell-options"
        data-sections={sections?.join(",") ?? "all"}
      >
        PowerShell: {sections?.join(",") ?? "all"}
      </div>
    ),
  }),
);

vi.mock("../../connectionEditor/CloudProviderOptions", () => ({
  default: () => <div data-testid="cloud-options">Cloud provider</div>,
}));

vi.mock("../../connectionEditor/ARDOptions", () => ({
  default: ({ sections }: any) => (
    <div data-testid="ard-options" data-sections={sections?.join(",") ?? "all"}>
      ARD: {sections?.join(",") ?? "all"}
    </div>
  ),
}));

vi.mock("../../connectionEditor/SerialOptions", () => ({
  SerialOptions: ({ sections }: any) => (
    <div
      data-testid="serial-options"
      data-sections={sections?.join(",") ?? "all"}
    >
      Serial: {sections?.join(",") ?? "all"}
    </div>
  ),
}));

vi.mock("../../connectionEditor/SavedProtocolOptions", () => ({
  default: ({ formData, section }: any) => (
    <div
      data-testid="saved-protocol-options"
      data-protocol={formData.protocol}
      data-section={section}
    >
      {formData.protocol}: {section}
    </div>
  ),
}));

vi.mock("./NetworkPathSection", () => ({
  default: ({ formData }: any) => (
    <div data-testid="network-path-section">
      Network path for {formData.protocol}
    </div>
  ),
}));

vi.mock("../../connectionEditor/TOTPOptions", () => ({
  default: () => <div data-testid="totp-options">totp-options</div>,
}));

vi.mock("../../connectionEditor/BackupCodesSection", () => ({
  default: () => <div data-testid="backup-codes">backup-codes</div>,
}));

vi.mock("../../connectionEditor/SecurityQuestionsSection", () => ({
  default: () => <div data-testid="security-questions">security-questions</div>,
}));

vi.mock("../../connectionEditor/RecoveryInfoSection", () => ({
  default: () => <div data-testid="recovery-info">recovery-info</div>,
}));

const Harness: React.FC<{
  initial: Partial<Connection>;
  activeSubtabId?: ProtocolSubtabId;
}> = ({ initial, activeSubtabId }) => {
  const [formData, setFormData] = useState<Partial<Connection>>(initial);
  const mgr = {
    formData,
    setFormData,
    sshSecrets: undefined,
  } as unknown as ConnectionEditorMgr;

  return (
    <>
      <button
        type="button"
        onClick={() =>
          setFormData((previous) => ({ ...previous, protocol: "rdp" }))
        }
      >
        Use RDP
      </button>
      <button
        type="button"
        onClick={() =>
          setFormData((previous) => ({ ...previous, protocol: "ssh" }))
        }
      >
        Use SSH
      </button>
      <button
        type="button"
        onClick={() =>
          setFormData((previous) => ({ ...previous, protocol: "raw" }))
        }
      >
        Use Raw
      </button>
      <button
        type="button"
        onClick={() =>
          setFormData((previous) => ({ ...previous, protocol: "rlogin" }))
        }
      >
        Use RLogin
      </button>
      <button
        type="button"
        onClick={() =>
          setFormData((previous) => ({ ...previous, protocol: "winrm" }))
        }
      >
        Use PowerShell
      </button>
      <ProtocolSections mgr={mgr} activeSubtabId={activeSubtabId} />
      <output data-testid="protocol-form-state">
        {JSON.stringify(formData)}
      </output>
    </>
  );
};

const idsFor = (formData: Partial<Connection>) =>
  getProtocolSubtabs(formData).map((subtab) => subtab.id);

describe("ProtocolSections", () => {
  it("characterizes applicable subtabs for every major protocol family", () => {
    expect(idsFor({ protocol: "rdp" })).toEqual([
      "connection",
      "authentication",
      "display-input",
      "resources",
      "security",
      "network-path",
      "network",
      "advanced",
      "recovery",
    ]);
    expect(idsFor({ protocol: "ssh" })).toEqual([
      "authentication",
      "terminal",
      "network-path",
      "network",
      "recovery",
    ]);
    expect(idsFor({ protocol: "https" })).toEqual([
      "authentication",
      "security",
      "advanced",
      "recovery",
    ]);
    expect(idsFor({ protocol: "winrm" })).toEqual([
      "connection",
      "authentication",
      "security",
      "network-path",
      "advanced",
    ]);
    expect(idsFor({ protocol: "raw" })).toEqual([
      "connection",
      "terminal",
      "security",
      "network-path",
      "advanced",
    ]);
    expect(idsFor({ protocol: "rlogin" })).toEqual([
      "connection",
      "terminal",
      "security",
      "network-path",
      "advanced",
    ]);
    expect(idsFor({ protocol: "ard" })).toEqual([
      "connection",
      "authentication",
      "display-input",
      "recovery",
    ]);
    expect(idsFor({ protocol: "serial" })).toEqual([
      "connection",
      "terminal",
      "advanced",
    ]);
    expect(idsFor({ protocol: "sftp" })).toEqual([
      "authentication",
      "recovery",
    ]);
    for (const protocol of ["ftp", "scp"] as const) {
      expect(idsFor({ protocol })).toEqual([
        "connection",
        "authentication",
        "security",
        "advanced",
        "recovery",
      ]);
    }
    expect(idsFor({ protocol: "postgresql" })).toEqual([
      "connection",
      "authentication",
      "security",
      "advanced",
      "recovery",
    ]);
    for (const protocol of ["telnet", "mysql", "smb", "rustdesk"] as const) {
      expect(idsFor({ protocol })).toEqual(["connection", "recovery"]);
    }
    expect(idsFor({ protocol: "gcp" })).toEqual([
      "provider",
      "authentication",
      "recovery",
    ]);
    expect(idsFor({ protocol: "integration:grafana" })).toEqual([
      "authentication",
      "recovery",
    ]);
    expect(idsFor({ protocol: "https", osType: "windows" })).toEqual([
      "authentication",
      "security",
      "advanced",
      "network",
      "recovery",
    ]);
  });

  it("groups RDP adapters without duplicating unrelated sections", () => {
    render(<Harness initial={{ protocol: "rdp", isGroup: false }} />);

    expect(screen.getByRole("tab", { name: "Connection" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("rdp-options")).toHaveAttribute(
      "data-sections",
      "connection",
    );
    expect(screen.getByTestId("winrm-options")).toHaveAttribute(
      "data-sections",
      "connection",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Resources" }));
    expect(screen.getByTestId("rdp-options")).toHaveAttribute(
      "data-sections",
      "devices,performance",
    );
    expect(screen.queryByTestId("winrm-options")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Network" }));
    expect(screen.getByTestId("rdp-options")).toHaveAttribute(
      "data-sections",
      "gateway,tcp",
    );
    expect(screen.getByTestId("winrm-options")).toHaveAttribute(
      "data-sections",
      "transport",
    );
  });

  it("uses one dedicated Network Path section for both SSH and RDP", () => {
    render(<Harness initial={{ protocol: "ssh", isGroup: false }} />);

    fireEvent.click(screen.getByRole("tab", { name: "Network Path" }));
    expect(screen.getByTestId("network-path-section")).toHaveTextContent(
      "Network path for ssh",
    );
    expect(screen.queryByTestId("ssh-options")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use RDP" }));
    fireEvent.click(screen.getByRole("tab", { name: "Network Path" }));
    expect(screen.getByTestId("network-path-section")).toHaveTextContent(
      "Network path for rdp",
    );

    fireEvent.click(screen.getByRole("button", { name: "Use Raw" }));
    fireEvent.click(screen.getByRole("tab", { name: "Network Path" }));
    expect(screen.getByTestId("network-path-section")).toHaveTextContent(
      "Network path for raw",
    );

    fireEvent.click(screen.getByRole("button", { name: "Use RLogin" }));
    fireEvent.click(screen.getByRole("tab", { name: "Network Path" }));
    expect(screen.getByTestId("network-path-section")).toHaveTextContent(
      "Network path for rlogin",
    );
  });

  it("mounts each standalone advanced protocol editor on its owning subtab", () => {
    render(<Harness initial={{ protocol: "raw", isGroup: false }} />);

    expect(screen.getByTestId("raw-options")).toHaveAttribute(
      "data-sections",
      "connection",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(screen.getByTestId("raw-options")).toHaveAttribute(
      "data-sections",
      "data",
    );

    fireEvent.click(screen.getByRole("button", { name: "Use RLogin" }));
    expect(screen.getByTestId("rlogin-options")).toHaveAttribute(
      "data-section",
      "connection",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));
    expect(screen.getByTestId("rlogin-options")).toHaveAttribute(
      "data-section",
      "security",
    );

    fireEvent.click(screen.getByRole("button", { name: "Use PowerShell" }));
    expect(screen.getByTestId("powershell-options")).toHaveAttribute(
      "data-sections",
      "endpoint",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByTestId("powershell-options")).toHaveAttribute(
      "data-sections",
      "ssh,session,windows-tools",
    );
  });

  it("mounts Serial settings on connection, terminal, and advanced subtabs", () => {
    render(<Harness initial={{ protocol: "serial", isGroup: false }} />);

    expect(screen.getByTestId("serial-options")).toHaveAttribute(
      "data-sections",
      "connection",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(screen.getByTestId("serial-options")).toHaveAttribute(
      "data-sections",
      "terminal",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
    expect(screen.getByTestId("serial-options")).toHaveAttribute(
      "data-sections",
      "advanced",
    );
  });

  it("mounts ARD and saved-protocol editors only on their owning subtabs", () => {
    const { rerender } = render(
      <Harness initial={{ protocol: "ard", isGroup: false }} />,
    );

    expect(screen.getByTestId("ard-options")).toHaveAttribute(
      "data-sections",
      "connection",
    );
    expect(
      screen.queryByRole("tab", { name: "Network Path" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Authentication" }));
    expect(screen.getByTestId("ard-options")).toHaveAttribute(
      "data-sections",
      "authentication",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Display & Input" }));
    expect(screen.getByTestId("ard-options")).toHaveAttribute(
      "data-sections",
      "display-input",
    );

    rerender(
      <Harness key="sftp" initial={{ protocol: "sftp", isGroup: false }} />,
    );
    expect(screen.getByTestId("saved-protocol-options")).toHaveAttribute(
      "data-protocol",
      "sftp",
    );
    expect(screen.getByTestId("saved-protocol-options")).toHaveAttribute(
      "data-section",
      "authentication",
    );
  });

  it("does not render SSH controls for unrelated protocol fallbacks", () => {
    render(<Harness initial={{ protocol: "vnc", isGroup: false }} />);

    expect(screen.queryByTestId("ssh-options")).not.toBeInTheDocument();
    expect(screen.getByTestId("saved-protocol-options")).toHaveAttribute(
      "data-protocol",
      "vnc",
    );
    expect(screen.getByTestId("saved-protocol-options")).toHaveAttribute(
      "data-section",
      "authentication",
    );
  });

  it.each(["ftp", "scp"] as const)(
    "routes every populated %s subtab to its matching saved-protocol section",
    (protocol) => {
      render(<Harness initial={{ protocol, isGroup: false }} />);

      for (const [tabLabel, expectedSection] of [
        ["Connection", "connection"],
        ["Authentication", "authentication"],
        ["Security", "security"],
        ["Advanced", "advanced"],
      ] as const) {
        fireEvent.click(screen.getByRole("tab", { name: tabLabel }));
        expect(screen.getByTestId("saved-protocol-options")).toHaveAttribute(
          "data-protocol",
          protocol,
        );
        expect(screen.getByTestId("saved-protocol-options")).toHaveAttribute(
          "data-section",
          expectedSection,
        );
      }
    },
  );

  it("routes every populated PostgreSQL subtab to its matching editor section", () => {
    render(<Harness initial={{ protocol: "postgresql", isGroup: false }} />);

    for (const [tabLabel, expectedSection] of [
      ["Connection", "connection"],
      ["Authentication", "authentication"],
      ["Security", "security"],
      ["Advanced", "advanced"],
    ] as const) {
      fireEvent.click(screen.getByRole("tab", { name: tabLabel }));
      expect(screen.getByTestId("saved-protocol-options")).toHaveAttribute(
        "data-protocol",
        "postgresql",
      );
      expect(screen.getByTestId("saved-protocol-options")).toHaveAttribute(
        "data-section",
        expectedSection,
      );
    }
  });

  it("uses roving focus with Arrow, Home, and End navigation", async () => {
    render(<Harness initial={{ protocol: "https", isGroup: false }} />);

    const authentication = screen.getByRole("tab", {
      name: "Authentication",
    });
    authentication.focus();
    fireEvent.keyDown(authentication, { key: "ArrowRight" });

    const security = screen.getByRole("tab", { name: "Security" });
    await waitFor(() => expect(security).toHaveFocus());
    expect(security).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(security, { key: "End" });
    const recovery = screen.getByRole("tab", { name: "Recovery" });
    await waitFor(() => expect(recovery).toHaveFocus());
    expect(recovery).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(recovery, { key: "Home" });
    await waitFor(() => expect(authentication).toHaveFocus());
    expect(authentication).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(authentication, { key: "ArrowLeft" });
    await waitFor(() => expect(recovery).toHaveFocus());
  });

  it("preserves form values and remembers the active subtab per protocol", () => {
    render(<Harness initial={{ protocol: "rdp", isGroup: false }} />);

    fireEvent.change(screen.getByLabelText("Mock RDP domain"), {
      target: { value: "CONTOSO" },
    });
    fireEvent.click(screen.getByRole("tab", { name: "Network" }));
    fireEvent.click(screen.getByRole("button", { name: "Use SSH" }));
    expect(screen.getByRole("tab", { name: "Authentication" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Terminal" }));

    fireEvent.click(screen.getByRole("button", { name: "Use RDP" }));
    expect(screen.getByRole("tab", { name: "Network" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Connection" }));
    expect(screen.getByLabelText("Mock RDP domain")).toHaveValue("CONTOSO");

    fireEvent.click(screen.getByRole("button", { name: "Use SSH" }));
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("accepts a controlled subtab request for search navigation", () => {
    render(
      <Harness
        initial={{ protocol: "https", isGroup: false }}
        activeSubtabId="security"
      />,
    );

    expect(screen.getByRole("tab", { name: "Security" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByTestId("http-options")).toHaveAttribute(
      "data-sections",
      "security",
    );
    expect(
      screen.getByTestId("connection-editor-protocol-subtab-panel-security"),
    ).toHaveAttribute(
      "aria-labelledby",
      "connection-editor-protocol-subtab-security",
    );
  });

  it("keeps all account recovery controls on the Recovery page", () => {
    render(<Harness initial={{ protocol: "integration:grafana" }} />);
    fireEvent.click(screen.getByRole("tab", { name: "Recovery" }));

    expect(screen.getByTestId("totp-options")).toBeInTheDocument();
    expect(screen.getByTestId("backup-codes")).toBeInTheDocument();
    expect(screen.getByTestId("security-questions")).toBeInTheDocument();
    expect(screen.getByTestId("recovery-info")).toBeInTheDocument();
    expect(screen.queryByTestId("ssh-options")).not.toBeInTheDocument();
  });
});
