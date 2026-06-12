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

vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getAllDatabases: vi.fn().mockResolvedValue([]),
      getCurrentDatabase: vi.fn().mockReturnValue(null),
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

  it("defaults the non-loopback bind toggle off and includes it in saved params", async () => {
    const onSave = vi.fn();

    renderWithProvider(
      <SSHTunnelDialog
        isOpen
        onClose={() => {}}
        onSave={onSave}
        sshConnections={sshConnections}
      />,
    );

    // The security hint and toggle are present.
    expect(
      screen.getByText(/Allow binding to non-loopback \(public\) interface/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/binds to 127\.0\.0\.1 \(loopback only\)/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("My SSH Tunnel"), {
      target: { value: "Loopback Tunnel" },
    });
    const sshSelectTrigger = screen.getAllByRole("combobox")[0];
    fireEvent.click(sshSelectTrigger);
    fireEvent.mouseDown(screen.getByText(/SSH Prod/));

    fireEvent.click(screen.getByRole("button", { name: "Create Tunnel" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Loopback Tunnel",
          allowNonLoopbackBind: false,
        }),
      );
    });
  });

  it("opts in to non-loopback bind when the toggle is enabled", async () => {
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
      target: { value: "Public Tunnel" },
    });
    const sshSelectTrigger = screen.getAllByRole("combobox")[0];
    fireEvent.click(sshSelectTrigger);
    fireEvent.mouseDown(screen.getByText(/SSH Prod/));

    // Toggle the non-loopback bind checkbox on. The auto-connect checkbox is
    // the first checkbox; the non-loopback one is the last.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[checkboxes.length - 1]);

    fireEvent.click(screen.getByRole("button", { name: "Create Tunnel" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Public Tunnel",
          allowNonLoopbackBind: true,
        }),
      );
    });
  });
});
