import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { SSHTunnelDialog } from "../../src/components/ssh/SSHTunnelDialog";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import {
  ConnectionContext,
  type ConnectionContextType,
} from "../../src/contexts/ConnectionContextTypes";
import type { Connection } from "../../src/types/connection/connection";

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
      registerBeforeDatabaseTransition: vi.fn(() => () => {}),
      onCurrentDatabaseChange: vi.fn(() => () => {}),
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

    expect(
      screen.getByText("Tunnel Name", { exact: false }),
    ).toBeInTheDocument();
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

  describe("searchable SSH connection picker", () => {
    const folder = (id: string, name: string, parentId?: string) =>
      ({ id, name, parentId, isGroup: true, protocol: "ssh" }) as Connection;
    const ssh = (
      id: string,
      name: string,
      hostname: string,
      extra: Partial<Connection> = {},
    ) =>
      ({
        id,
        name,
        hostname,
        port: 22,
        protocol: "ssh",
        isGroup: false,
        ...extra,
      }) as Connection;

    const groups = [
      folder("folder-prod", "Production"),
      folder("folder-edge", "Edge"),
      folder("folder-dmz", "DMZ", "folder-edge"),
    ];
    const connections = [
      ssh("conn-prod", "SSH Prod", "prod.example.com", {
        username: "root",
        parentId: "folder-prod",
      }),
      ssh("conn-stage", "Staging Box", "stage.internal.lan", {
        username: "deploy",
      }),
      ssh("conn-cafe", "Café Bastion", "bastion.example.org", {
        username: "admin",
        parentId: "folder-dmz",
      }),
    ];
    const SEARCH_LABEL = "Search by name, host, user or folder…";
    const PROD = "SSH Prod (prod.example.com:22)Production · user root";
    const STAGE = "Staging Box (stage.internal.lan:22)user deploy";
    const CAFE = "Café Bastion (bastion.example.org:22)Edge / DMZ · user admin";

    const renderPicker = (
      props: Partial<React.ComponentProps<typeof SSHTunnelDialog>> = {},
    ) => {
      const value = {
        state: { connections: [...groups, ...connections] },
      } as unknown as ConnectionContextType;
      return render(
        <ConnectionContext.Provider value={value}>
          <SSHTunnelDialog
            isOpen
            onClose={() => {}}
            onSave={() => {}}
            sshConnections={connections}
            {...props}
          />
        </ConnectionContext.Provider>,
      );
    };

    const trigger = () => screen.getByTestId("ssh-tunnel-connection-select");
    const searchInput = () =>
      screen.getByRole("textbox", { name: SEARCH_LABEL });
    const openPicker = () => {
      fireEvent.click(trigger());
      return searchInput();
    };
    const visibleOptionLabels = () =>
      within(screen.getByRole("listbox"))
        .queryAllByRole("option")
        .map((option) => option.textContent);

    it("labels the picker and wires the combobox to its listbox", () => {
      renderPicker();

      expect(screen.getByRole("combobox", { name: "SSH connection" })).toBe(
        trigger(),
      );
      const search = openPicker();
      const listbox = screen.getByRole("listbox");
      expect(trigger()).toHaveAttribute("aria-expanded", "true");
      expect(trigger()).toHaveAttribute("aria-controls", listbox.id);
      expect(search).toHaveAttribute("aria-controls", listbox.id);
      expect(search).toHaveAttribute("aria-autocomplete", "list");
    });

    it("shows folder and user details so connections can be told apart", () => {
      renderPicker();
      openPicker();

      expect(visibleOptionLabels()).toEqual([
        "Select SSH connection...",
        PROD,
        STAGE,
        CAFE,
      ]);
    });

    it("filters by connection name", () => {
      renderPicker();
      fireEvent.change(openPicker(), { target: { value: "staging" } });

      expect(visibleOptionLabels()).toEqual([STAGE]);
    });

    it("filters by host", () => {
      renderPicker();
      const search = openPicker();

      fireEvent.change(search, { target: { value: "stage.internal" } });
      expect(visibleOptionLabels()).toEqual([STAGE]);

      fireEvent.change(search, { target: { value: "EXAMPLE" } });
      expect(visibleOptionLabels()).toEqual([PROD, CAFE]);
    });

    it("filters by username, folder path, accents and multiple words", () => {
      renderPicker();
      const search = openPicker();

      fireEvent.change(search, { target: { value: "deploy" } });
      expect(visibleOptionLabels()).toEqual([STAGE]);

      fireEvent.change(search, { target: { value: "edge / dmz" } });
      expect(visibleOptionLabels()).toEqual([CAFE]);

      fireEvent.change(search, { target: { value: "cafe" } });
      expect(visibleOptionLabels()).toEqual([CAFE]);

      fireEvent.change(search, { target: { value: "production root" } });
      expect(visibleOptionLabels()).toEqual([PROD]);

      fireEvent.change(search, { target: { value: "nowhere" } });
      expect(visibleOptionLabels()).toEqual([]);
      expect(screen.getByText("No matches")).toBeInTheDocument();
    });

    it("selects the highlighted match with the keyboard and saves its id", async () => {
      const onSave = vi.fn();
      renderPicker({ onSave });

      fireEvent.change(screen.getByPlaceholderText("My SSH Tunnel"), {
        target: { value: "Keyboard Tunnel" },
      });
      const search = openPicker();
      fireEvent.change(search, { target: { value: "example" } });

      const [prodOption, cafeOption] = within(
        screen.getByRole("listbox"),
      ).getAllByRole("option");
      expect(search).toHaveAttribute("aria-activedescendant", prodOption.id);
      fireEvent.keyDown(search, { key: "ArrowDown" });
      expect(search).toHaveAttribute("aria-activedescendant", cafeOption.id);
      fireEvent.keyDown(search, { key: "Enter" });

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(trigger()).toHaveTextContent(
        "Café Bastion (bastion.example.org:22)",
      );
      expect(trigger()).toHaveFocus();

      fireEvent.click(screen.getByRole("button", { name: "Create Tunnel" }));
      await waitFor(() => {
        expect(onSave).toHaveBeenCalledWith(
          expect.objectContaining({
            name: "Keyboard Tunnel",
            sshConnectionId: "conn-cafe",
          }),
        );
      });
    });

    it("opens from the keyboard and closes on Escape without selecting", () => {
      renderPicker();

      fireEvent.keyDown(trigger(), { key: "ArrowDown" });
      const search = searchInput();
      fireEvent.change(search, { target: { value: "staging" } });
      fireEvent.keyDown(search, { key: "Escape" });

      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(trigger()).toHaveTextContent("Select SSH connection...");
      expect(trigger()).toHaveFocus();
      // The filter resets for the next open.
      openPicker();
      expect(visibleOptionLabels()).toHaveLength(4);
    });

    it("keeps the empty option, which clears the connection and blocks saving", () => {
      const onSave = vi.fn();
      renderPicker({ onSave });

      fireEvent.change(screen.getByPlaceholderText("My SSH Tunnel"), {
        target: { value: "Cleared Tunnel" },
      });
      fireEvent.change(openPicker(), { target: { value: "staging" } });
      fireEvent.keyDown(searchInput(), { key: "Enter" });
      const create = screen.getByRole("button", { name: "Create Tunnel" });
      expect(create).toBeEnabled();

      openPicker();
      fireEvent.mouseDown(
        within(screen.getByRole("listbox")).getByRole("option", {
          name: "Select SSH connection...",
        }),
      );

      expect(trigger()).toHaveTextContent("Select SSH connection...");
      expect(create).toBeDisabled();
      fireEvent.submit(create.closest("form") as HTMLFormElement);
      expect(onSave).not.toHaveBeenCalled();
    });

    it("shows a pre-selected connection when editing a tunnel", () => {
      renderPicker({
        editingTunnel: {
          id: "tunnel-1",
          name: "Existing",
          sshConnectionId: "conn-stage",
          localPort: 8080,
          remoteHost: "localhost",
          remotePort: 80,
          type: "local",
          autoConnect: false,
        },
      });

      expect(trigger()).toHaveTextContent(
        "Staging Box (stage.internal.lan:22)",
      );
      expect(
        screen.getByRole("button", { name: "Save Changes" }),
      ).toBeEnabled();

      const search = openPicker();
      const selected = within(screen.getByRole("listbox")).getByRole("option", {
        selected: true,
      });
      expect(selected).toHaveTextContent("Staging Box");
      expect(search).toHaveAttribute("aria-activedescendant", selected.id);
    });
  });
});
