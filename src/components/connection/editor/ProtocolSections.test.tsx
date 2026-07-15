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

vi.mock("../../connectionEditor/CloudProviderOptions", () => ({
  default: () => <div data-testid="cloud-options">Cloud provider</div>,
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
      "network",
      "advanced",
      "recovery",
    ]);
    expect(idsFor({ protocol: "ssh" })).toEqual([
      "authentication",
      "terminal",
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
      "network",
      "advanced",
      "recovery",
    ]);
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
