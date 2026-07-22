import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VpnEditor } from "./VpnEditor";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("VpnEditor OpenVPN configuration sources", () => {
  it("offers every persisted session provider with a catalog-backed icon", () => {
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    for (const label of [
      "OpenVPN",
      "WireGuard",
      "Tailscale",
      "ZeroTier",
      "PPTP",
      "L2TP/IPsec",
      "IKEv2",
      "IPsec",
      "SSTP",
    ]) {
      const choice = screen.getByRole("button", { name: label });
      expect(choice.querySelector("svg")).not.toBeNull();
    }
    expect(
      screen.queryByRole("button", { name: "SoftEther" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "IKEv2" }));
    expect(screen.getByText("IKEv2 Configuration")).toBeInTheDocument();
    expect(screen.getByText("Traffic Routing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "IPsec" }));
    expect(screen.getByText("IPsec Configuration")).toBeInTheDocument();
    expect(screen.getByText("Traffic Routing")).toBeInTheDocument();
  });

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

  it("shows stored secrets without prefilling them and makes clear intent explicit", () => {
    render(
      <VpnEditor
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        editingConnection={{
          id: "openvpn-office",
          vpnType: "openvpn",
          name: "Office VPN",
          config: { remoteHost: "vpn.example.com" },
          secretPresence: {
            password: true,
            inlineConfig: false,
            clientKey: false,
          },
        }}
      />,
    );

    const password = screen.getByPlaceholderText(
      "Stored secret — leave blank to keep",
    );
    expect(password).toHaveValue("");
    const field = password.parentElement;
    expect(field).not.toBeNull();
    fireEvent.click(
      within(field!).getByRole("button", { name: "Clear stored secret" }),
    );
    expect(
      within(field!).getByText(/stored secret will be cleared/i),
    ).toBeInTheDocument();

    fireEvent.change(password, { target: { value: "replacement-secret" } });
    expect(
      within(field!).getByText(/new value will replace the stored secret/i),
    ).toBeInTheDocument();
    expect(
      within(field!).queryByText(/stored secret will be cleared/i),
    ).not.toBeInTheDocument();
  });

  it("makes an intentionally keyless WireGuard profile visible", () => {
    render(
      <VpnEditor
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        editingConnection={{
          id: "wg-keyless",
          vpnType: "wireguard",
          name: "Keyless WireGuard",
          config: {
            interface: { privateKey: "", address: [] },
            peer: { publicKey: "peer-public", allowedIPs: ["0.0.0.0/0"] },
          },
          secretPresence: { privateKey: false, presharedKey: false },
        }}
      />,
    );

    expect(screen.getByText(/profile has no private key/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Base64-encoded private key"),
    ).toHaveValue("");
  });

  it("shows ZeroTier identity and token presence without returning either secret", () => {
    render(
      <VpnEditor
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        editingConnection={{
          id: "zt-office",
          vpnType: "zerotier",
          name: "Office ZeroTier",
          config: {
            networkId: "8056c2e21c000001",
            identity: { public: "public-id", secret: "" },
          },
          secretPresence: {
            identitySecret: true,
            authtokenSecret: true,
          },
        }}
      />,
    );

    expect(screen.getByDisplayValue("public-id")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/stored identity secret/i)).toHaveValue(
      "",
    );
    expect(screen.getByPlaceholderText(/stored auth token/i)).toHaveValue("");
    expect(screen.getAllByText(/stored securely/i)).toHaveLength(2);
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
