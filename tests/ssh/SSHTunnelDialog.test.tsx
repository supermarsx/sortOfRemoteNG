import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SSHTunnelDialog } from "../../src/components/ssh/SSHTunnelDialog";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";

vi.mock("../../src/utils/settings/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      logAction: vi.fn(),
      getSettings: vi.fn().mockReturnValue({}),
      loadSettings: vi.fn().mockResolvedValue({}),
      saveSettings: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("../../src/utils/connection/collectionManager", () => ({
  CollectionManager: {
    getInstance: () => ({
      getAllCollections: vi.fn().mockResolvedValue([]),
      getCurrentCollection: vi.fn().mockReturnValue(null),
    }),
    resetInstance: vi.fn(),
  },
}));

vi.mock("../../src/utils/settings/themeManager", () => ({
  ThemeManager: {
    getInstance: () => ({
      applyTheme: vi.fn(),
      getCurrentTheme: vi.fn().mockReturnValue("dark"),
    }),
  },
}));

describe("SSHTunnelDialog", () => {
  const sshConnections = [
    {
      id: "conn-1",
      name: "SSH Prod",
      hostname: "prod.example.com",
      port: 22,
      protocol: "ssh",
      isGroup: false,
    } as any,
  ];

  const renderWithProvider = (ui: React.ReactElement) =>
    render(<ConnectionProvider>{ui}</ConnectionProvider>);

  it("does not render when closed", () => {
    renderWithProvider(
      <SSHTunnelDialog
        isOpen={false}
        onClose={() => {}}
        onSave={() => {}}
        sshConnections={sshConnections}
      />,
    );

    expect(screen.queryByText("Tunnel Name")).not.toBeInTheDocument();
  });

  it("closes when Cancel button is clicked", async () => {
    const onClose = vi.fn();
    renderWithProvider(
      <SSHTunnelDialog
        isOpen
        onClose={onClose}
        onSave={() => {}}
        sshConnections={sshConnections}
      />,
    );

    expect(screen.getByText("Tunnel Name", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Cancel"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("submits valid tunnel form", async () => {
    const onSave = vi.fn();

    renderWithProvider(
      <SSHTunnelDialog
        isOpen
        onClose={() => {}}
        onSave={onSave}
        sshConnections={sshConnections}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("My SSH Tunnel"), {
      target: { value: "My Tunnel" },
    });
    // Open the custom Select dropdown and select the SSH connection
    const sshSelectTrigger = screen.getAllByRole("combobox")[0];
    fireEvent.click(sshSelectTrigger);
    fireEvent.mouseDown(screen.getByText(/SSH Prod/));

    fireEvent.change(screen.getByPlaceholderText("0 = auto"), {
      target: { value: "1080" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Create Tunnel" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "My Tunnel",
          sshConnectionId: "conn-1",
          localPort: 1080,
          type: "local",
        }),
      );
    });
  });
});
