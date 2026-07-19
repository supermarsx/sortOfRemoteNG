import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VpnEditor } from "./VpnEditor";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("VpnEditor OpenVPN configuration sources", () => {
  it("shows and requires the selected manual TLS key files", () => {
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("My VPN Connection"), {
      target: { value: "Office VPN" },
    });
    fireEvent.click(screen.getByLabelText("TLS Auth"));

    expect(screen.getByText("TLS Auth Key File")).toBeInTheDocument();
    expect(
      screen.getByText("A key file is required for manual TLS Auth."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create VPN" })).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("TLS Auth Key"), {
      target: { value: "C:/vpn/tls-auth.key" },
    });

    expect(screen.getByRole("button", { name: "Create VPN" })).toBeEnabled();
  });

  it("keeps manual TLS Auth and TLS Crypt mutually exclusive", () => {
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    const tlsAuth = screen.getByLabelText("TLS Auth");
    const tlsCrypt = screen.getByLabelText("TLS Crypt");
    fireEvent.click(tlsAuth);
    expect(tlsAuth).toBeChecked();
    expect(tlsCrypt).not.toBeChecked();
    expect(screen.getByText("TLS Auth Key File")).toBeInTheDocument();

    fireEvent.click(tlsCrypt);
    expect(tlsAuth).not.toBeChecked();
    expect(tlsCrypt).toBeChecked();
    expect(screen.queryByText("TLS Auth Key File")).not.toBeInTheDocument();
    expect(screen.getByText("TLS Crypt Key File")).toBeInTheDocument();
  });

  it("treats an imported config as authoritative and keeps auth override controls", () => {
    render(
      <VpnEditor
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        editingConnection={{
          id: "openvpn-office",
          vpnType: "openvpn",
          name: "Office VPN",
          config: {
            inlineConfig: "client\nremote vpn.example.com\n",
            tlsAuth: true,
            remoteHost: "metadata-only.example.com",
          },
        }}
      />,
    );

    expect(
      screen.getByText(/configuration is authoritative for server/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("TLS Auth")).not.toBeInTheDocument();
    expect(screen.queryByText("Remote Host")).not.toBeInTheDocument();
    expect(screen.getByText("Auth File")).toBeInTheDocument();
    expect(screen.getByText("Switch to manual")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update VPN" })).toBeEnabled();
  });
});
