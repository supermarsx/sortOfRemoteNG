import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TunnelProfileEditorPanel from "../../src/components/network/proxyChainMenu/TunnelProfileEditorPanel";
import TunnelChainEditorPanel from "../../src/components/network/proxyChainMenu/TunnelChainEditorPanel";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";

const storage = vi.hoisted(() => ({
  createTunnelProfile: vi.fn(),
  createTunnelChain: vi.fn(),
  getTunnelProfiles: vi.fn(() => []),
}));
vi.mock("../../src/utils/connection/proxyCollectionManager", () => ({
  proxyCollectionManager: storage,
}));
vi.mock("../../src/hooks/network/useVpnManager", () => ({
  useVpnManager: () => ({
    profileCatalog: { profiles: [], providerStatus: {} },
  }),
}));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settings: {} }),
}));

describe("tunnel definition editors", () => {
  beforeEach(() => vi.clearAllMocks());

  it("saves a searchable SSH link from the themed profile editor without copying credentials", async () => {
    const onSave = vi.fn();
    const context = {
      state: {
        connections: [
          {
            id: "bastion",
            name: "Office Bastion",
            protocol: "ssh",
            hostname: "ssh.example",
            port: 22,
            username: "alice",
            password: "saved-secret",
          },
        ],
      },
      databaseAvailability: {
        status: "ready",
        databaseId: "db",
        generation: 1,
      },
    } as ConnectionContextType;
    render(
      <ConnectionContext.Provider value={context}>
        <TunnelProfileEditorPanel isOpen onClose={vi.fn()} onSave={onSave} />
      </ConnectionContext.Provider>,
    );
    const name = screen.getByPlaceholderText(
      "e.g. Office WireGuard, Bastion SSH",
    );
    expect(name).toHaveClass("sor-form-input");
    fireEvent.change(name, { target: { value: "Office tunnel" } });
    fireEvent.click(screen.getByRole("button", { name: "SSH Tunnel" }));
    const password = screen.getByLabelText("SSH password");
    expect(password.parentElement).toHaveClass("relative", "w-full");
    expect(password).toHaveStyle({ paddingRight: "2.25rem" });
    fireEvent.change(password, { target: { value: "draft-secret" } });
    fireEvent.click(screen.getByRole("combobox", { name: "SSH source" }));
    fireEvent.mouseDown(
      screen.getByRole("option", { name: "Saved SSH connection" }),
    );
    const linked = screen.getByRole("combobox", {
      name: "Saved SSH connection",
    });
    expect(linked).toHaveClass("sor-form-select");
    fireEvent.click(linked);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search SSH connections…" }),
      { target: { value: "ssh.example" } },
    );
    const menu = screen.getByRole("listbox", { name: "Saved SSH connection" });
    expect(menu.closest(".sor-select-dropdown")).toHaveClass(
      "sor-popover-panel",
    );
    fireEvent.mouseDown(
      within(menu).getByRole("option", { name: /Office Bastion/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(storage.createTunnelProfile).toHaveBeenCalledWith(
      "Office tunnel",
      "ssh-tunnel",
      expect.objectContaining({
        sshTunnel: expect.objectContaining({
          connectionId: "bastion",
          ownerDatabaseId: "db",
          password: undefined,
          host: undefined,
        }),
      }),
      expect.any(Object),
    );
    expect(JSON.stringify(storage.createTunnelProfile.mock.calls)).not.toMatch(
      /saved-secret|draft-secret/,
    );
  });

  it("edits and saves a proxy layer through themed chain controls", async () => {
    const onSave = vi.fn();
    render(<TunnelChainEditorPanel isOpen onClose={vi.fn()} onSave={onSave} />);
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Office VPN + Jump Host"),
      { target: { value: "Office chain" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add Layer" }));
    fireEvent.click(screen.getByRole("button", { name: "Proxy" }));
    fireEvent.click(screen.getByRole("button", { name: "Proxy" }));
    const type = screen.getByRole("combobox", { name: "Proxy type" });
    expect(type).toHaveClass("sor-form-select");
    fireEvent.click(type);
    fireEvent.mouseDown(screen.getByRole("option", { name: "HTTP CONNECT" }));
    fireEvent.change(screen.getByLabelText("Proxy host"), {
      target: { value: "proxy.example" },
    });
    expect(screen.getByLabelText("Proxy port")).toHaveClass("sor-form-input");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    expect(storage.createTunnelChain).toHaveBeenCalledWith(
      "Office chain",
      [
        expect.objectContaining({
          proxy: expect.objectContaining({
            proxyType: "http-connect",
            host: "proxy.example",
          }),
        }),
      ],
      expect.any(Object),
    );
  });
});
