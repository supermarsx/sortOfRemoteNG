import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VpnEditor } from "./VpnEditor";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

describe("VpnEditor OpenVPN configuration sources", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue("openvpn-profile-id");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it("offers every persisted session provider with a catalog-backed icon", () => {
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    const picker = screen.getByRole("button", {
      name: /connection provider/i,
    });
    expect(picker).toHaveTextContent("OpenVPN");
    fireEvent.click(picker);
    const choices = within(
      screen.getByRole("listbox", { name: "Available VPN types" }),
    );

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
      const choice = choices.getByRole("option", {
        name: new RegExp(
          `^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|$)`,
          "i",
        ),
      });
      expect(choice.querySelector("svg")).not.toBeNull();
    }
    expect(
      choices.queryByRole("option", { name: /SoftEther/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(choices.getByRole("option", { name: /IKEv2/i }));
    expect(screen.getByText("IKEv2 Configuration")).toBeInTheDocument();
    expect(screen.getByText("Traffic Routing")).toBeInTheDocument();

    fireEvent.click(picker);
    fireEvent.click(
      within(
        screen.getByRole("listbox", { name: "Available VPN types" }),
      ).getByRole("option", { name: /^IPsec /i }),
    );
    expect(screen.getByText("IPsec Configuration")).toBeInTheDocument();
    expect(screen.getByText("Traffic Routing")).toBeInTheDocument();
  });

  it("searches and keyboard-selects VPN types like the connection type picker", () => {
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.click(
      screen.getByRole("button", { name: /connection provider/i }),
    );
    const search = screen.getByRole("combobox", { name: "Search VPN types" });
    fireEvent.change(search, { target: { value: "modern encrypted" } });
    const choices = within(
      screen.getByRole("listbox", { name: "Available VPN types" }),
    );
    expect(choices.getAllByRole("option")).toHaveLength(1);
    expect(choices.getByRole("option")).toHaveTextContent("WireGuard");
    fireEvent.keyDown(search, { key: "Enter" });

    expect(screen.getByText("WireGuard Configuration")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /connection provider/i }),
    ).toHaveTextContent("WireGuard");
  });

  it("shows and requires the selected manual TLS key files", () => {
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("My VPN Connection"), {
      target: { value: "Office VPN" },
    });
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "vpn.example.com" },
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

  it("builds ordered remotes, random selection, routes, and DNS without raw directives", () => {
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("My VPN Connection"), {
      target: { value: "Resilient VPN" },
    });
    expect(screen.getByText("Remote 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create VPN" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "primary.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add remote" }));
    const hosts = screen.getAllByLabelText("Host");
    fireEvent.change(hosts[1], { target: { value: "backup.example.com" } });
    fireEvent.change(screen.getAllByLabelText("Protocol")[1], {
      target: { value: "tcp6" },
    });
    fireEvent.click(screen.getByLabelText("Random remote selection"));

    fireEvent.click(screen.getByRole("button", { name: "Add route" }));
    fireEvent.change(screen.getByLabelText("Route 1 network"), {
      target: { value: "10.20.0.0" },
    });
    fireEvent.change(screen.getByLabelText("Route 1 netmask"), {
      target: { value: "255.255.0.0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add DNS server" }));
    fireEvent.change(screen.getByLabelText("DNS 1 server"), {
      target: { value: "10.20.0.53" },
    });

    expect(screen.getByRole("button", { name: "Create VPN" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Move remote 2 up" }));
    expect(screen.getAllByLabelText("Host")[0]).toHaveValue(
      "backup.example.com",
    );
  });

  it("saves every ordered remote and failover option through the persisted IPC contract", async () => {
    const onSave = vi.fn();
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText("My VPN Connection"), {
      target: { value: "Production VPN" },
    });
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "primary.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add remote" }));
    fireEvent.change(screen.getAllByLabelText("Host")[1], {
      target: { value: "backup.example.com" },
    });
    fireEvent.change(screen.getAllByLabelText("Port")[1], {
      target: { value: "443" },
    });
    fireEvent.change(screen.getAllByLabelText("Protocol")[1], {
      target: { value: "tcp" },
    });
    fireEvent.click(screen.getByLabelText("Random remote selection"));
    fireEvent.click(screen.getByLabelText("Randomize hostname lookup"));
    const retryDns = screen.getByLabelText("Retry DNS resolution indefinitely");
    fireEvent.click(retryDns);
    fireEvent.click(retryDns);
    fireEvent.click(screen.getByRole("button", { name: "Create VPN" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("create_openvpn_connection", {
        name: "Production VPN",
        config: expect.objectContaining({
          remotes: [
            { host: "primary.example.com", port: 1194, protocol: "udp" },
            { host: "backup.example.com", port: 443, protocol: "tcp" },
          ],
          remote_random: true,
          remote_random_hostname: true,
          resolve_retry_infinite: true,
        }),
      }),
    );
    expect(onSave).toHaveBeenCalledOnce();
  });

  it("saves exact OpenVPN transport, retry, X.509, and redirect semantics", async () => {
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("My VPN Connection"), {
      target: { value: "Exact OpenVPN" },
    });
    fireEvent.change(screen.getByLabelText("Host"), {
      target: { value: "vpn.example.com" },
    });
    fireEvent.change(screen.getByLabelText("Protocol"), {
      target: { value: "tcp4" },
    });
    fireEvent.change(screen.getByLabelText("Verify server name"), {
      target: { value: "vpn-" },
    });
    fireEvent.change(screen.getByLabelText("Server name match"), {
      target: { value: "name-prefix" },
    });

    const maximumRetryDelay = screen.getByLabelText("Maximum retry delay (s)");
    expect(maximumRetryDelay).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Retry delay (s)"), {
      target: { value: "5" },
    });
    expect(maximumRetryDelay).toBeEnabled();
    fireEvent.change(maximumRetryDelay, { target: { value: "300" } });

    fireEvent.click(screen.getByLabelText("Redirect default gateway"));
    expect(
      screen.getByLabelText("Preserve the existing IPv4 default route (def1)"),
    ).toBeChecked();
    fireEvent.click(screen.getByLabelText("Redirect IPv6 traffic"));
    fireEvent.click(
      screen.getByLabelText("Preserve the existing IPv4 default route (def1)"),
    );
    fireEvent.click(screen.getByLabelText("Retry DNS resolution indefinitely"));
    fireEvent.click(screen.getByRole("button", { name: "Create VPN" }));

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("create_openvpn_connection", {
        name: "Exact OpenVPN",
        config: expect.objectContaining({
          remotes: [{ host: "vpn.example.com", port: 1194, protocol: "tcp4" }],
          resolve_retry_infinite: false,
          verify_x509_name: "vpn-",
          verify_x509_type: "name-prefix",
          connect_retry: 5,
          connect_retry_max_seconds: 300,
          redirect_gateway: true,
          redirect_gateway_flags: ["ipv6"],
        }),
      }),
    );
  });

  it("allows only newly pasted inline configuration to return to manual mode", () => {
    render(<VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Inline Configuration"), {
      target: { value: "client\nremote vpn.example.com\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch to manual" }));

    expect(screen.getByText("Remote servers")).toBeInTheDocument();
    expect(screen.getByLabelText("Host")).toHaveValue("");
  });

  it("hides Windows DNS blocking on other platforms but lets users clear a stored value", async () => {
    vi.spyOn(window.navigator, "platform", "get").mockReturnValue(
      "Linux x86_64",
    );
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (X11; Linux x86_64)",
    );
    const { unmount } = render(
      <VpnEditor isOpen onClose={vi.fn()} onSave={vi.fn()} />,
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText(/Block outside DNS/i),
      ).not.toBeInTheDocument(),
    );
    unmount();

    render(
      <VpnEditor
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        editingConnection={{
          id: "openvpn-windows-dns",
          vpnType: "openvpn",
          name: "Windows OpenVPN",
          config: {
            remoteHost: "vpn.example.com",
            blockOutsideDns: true,
          },
        }}
      />,
    );
    const storedSetting = await screen.findByLabelText(
      /Block outside DNS \(Windows only\)/i,
    );
    expect(storedSetting).toBeChecked();
    expect(storedSetting).toBeEnabled();
    expect(screen.getByText(/unsupported here/i)).toBeInTheDocument();
    fireEvent.click(storedSetting);
    expect(
      screen.queryByLabelText(/Block outside DNS/i),
    ).not.toBeInTheDocument();
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

  it("hydrates advanced OpenVPN profiles and locks their provider while editing", () => {
    render(
      <VpnEditor
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        editingConnection={{
          id: "openvpn-resilient",
          vpnType: "openvpn",
          name: "Resilient OpenVPN",
          config: {
            remotes: [
              { host: "primary.example.com", port: 1194, protocol: "udp" },
              { host: "backup.example.com", port: 443, protocol: "tcp" },
            ],
            remoteRandom: true,
            dataCiphers: ["AES-256-GCM", "AES-128-GCM"],
            route: [{ network: "10.20.0.0", netmask: "255.255.0.0" }],
            dns: [{ server: "10.20.0.53", domain: "corp.example" }],
          },
        }}
      />,
    );

    expect(screen.getAllByLabelText("Host")[0]).toHaveValue(
      "primary.example.com",
    );
    expect(screen.getAllByLabelText("Host")[1]).toHaveValue(
      "backup.example.com",
    );
    expect(screen.getByLabelText("Random remote selection")).toBeChecked();
    expect(screen.getByLabelText("Route 1 network")).toHaveValue("10.20.0.0");
    expect(screen.getByLabelText("DNS 1 server")).toHaveValue("10.20.0.53");
    expect(
      screen.getByDisplayValue("AES-256-GCM:AES-128-GCM"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /connection provider/i }),
    ).toBeDisabled();
    expect(
      screen.getByText(/VPN type is locked while editing/i),
    ).toBeInTheDocument();
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
    expect(screen.queryByText("Remote servers")).not.toBeInTheDocument();
    expect(screen.getByText("Auth File")).toBeInTheDocument();
    expect(screen.queryByText("Switch to manual")).not.toBeInTheDocument();
    expect(
      screen.getByText(/cannot be converted to manual fields/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Clear stored secret" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update VPN" })).toBeEnabled();
  });
});
