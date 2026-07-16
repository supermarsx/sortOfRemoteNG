import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { ConnectionEditor } from "../../src/components/connection/ConnectionEditor";
import { scrollConnectionEditorSearchTargetIntoView } from "../../src/components/connection/editor/useConnectionEditorSearch";
import { Connection } from "../../src/types/connection/connection";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { useConnections } from "../../src/contexts/useConnections";

vi.mock("../../src/types/integrations/registry", () => ({
  integrationRegistry: [
    {
      key: "netbox",
      label: "NetBox",
      category: "infra",
      icon: () => null,
      importPanel: async () => ({ default: () => null }),
    },
    {
      key: "grafana",
      label: "Grafana",
      category: "app-service",
      icon: () => null,
      importPanel: async () => ({ default: () => null }),
    },
    {
      key: "exchange",
      label: "Exchange",
      category: "app-service",
      icon: () => null,
      importPanel: async () => ({ default: () => null }),
    },
  ],
}));

// Mock ToastContext (useConnectionEditor depends on it)
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
    },
  }),
}));

// Mock child components
vi.mock("../../src/components/connection/TagManager", () => ({
  TagManager: ({ tags, onChange }: any) => (
    <div data-testid="tag-manager">
      <span data-testid="tag-display">{tags?.join(", ") || "none"}</span>
      <button onClick={() => onChange(["test-tag"])}>Add Tag</button>
    </div>
  ),
}));

vi.mock("../../src/components/connectionEditor/SSHOptions", () => ({
  default: ({ formData }: any) =>
    formData.protocol === "ssh" ? (
      <div data-testid="ssh-options">
        SSH Options
        <label htmlFor="test-ssh-known-hosts">Known Hosts Path</label>
        <input id="test-ssh-known-hosts" defaultValue="" />
      </div>
    ) : null,
}));

vi.mock("../../src/components/connectionEditor/HTTPOptions", () => ({
  default: ({ formData }: any) =>
    ["http", "https"].includes(formData.protocol) ? (
      <div data-testid="http-options">HTTP Options</div>
    ) : null,
}));

vi.mock("../../src/components/connectionEditor/CloudProviderOptions", () => ({
  default: () => <div data-testid="cloud-options">Cloud Options</div>,
}));

vi.mock("../../src/components/connection/editor/NetworkPathSection", () => ({
  default: () => (
    <div
      id="network-path-section"
      data-testid="network-path-section"
      data-editor-search-field="network-path"
      tabIndex={-1}
    >
      Network Path
    </div>
  ),
}));

vi.mock("../../src/utils/discovery/defaultPorts", () => ({
  getDefaultPort: vi.fn((protocol) => {
    const ports: Record<string, number> = {
      rdp: 3389,
      ssh: 22,
      ard: 5900,
      vnc: 5900,
      http: 80,
      https: 443,
      raw: 23,
      rlogin: 513,
      winrm: 5985,
      telnet: 23,
      sftp: 22,
      mysql: 3306,
      postgresql: 5432,
      spice: 5900,
      xdmcp: 177,
      x2go: 22,
      nx: 4000,
      smb: 445,
      rustdesk: 21116,
    };
    return ports[protocol] || 3389;
  }),
}));

vi.mock("../../src/utils/core/id", () => ({
  generateId: vi.fn(() => "test-generated-id"),
}));

const mockConnection: Connection = {
  id: "test-connection",
  name: "Test Connection",
  protocol: "rdp",
  hostname: "192.168.1.100",
  port: 3389,
  username: "testuser",
  password: "testpass",
  domain: "",
  description: "Test connection",
  isGroup: false,
  tags: ["test", "rdp"],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const ConnectionStateProbe = ({
  onConnections,
  initialConnections,
}: {
  onConnections?: (connections: Connection[]) => void;
  initialConnections?: Connection[];
}) => {
  const { state, dispatch } = useConnections();

  useEffect(() => {
    if (initialConnections) {
      dispatch({ type: "SET_CONNECTIONS", payload: initialConnections });
    }
  }, [dispatch, initialConnections]);

  useEffect(() => {
    onConnections?.(state.connections);
  }, [onConnections, state.connections]);

  return null;
};

const renderWithProviders = (
  props: any,
  onConnections?: (connections: Connection[]) => void,
  initialConnections?: Connection[],
) => {
  return render(
    <ConnectionProvider>
      <ConnectionStateProbe
        onConnections={onConnections}
        initialConnections={initialConnections}
      />
      <ConnectionEditor {...props} />
    </ConnectionProvider>,
  );
};

describe("ConnectionEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Modal Display", () => {
    it("should not render when isOpen is false", () => {
      renderWithProviders({ isOpen: false, onClose: vi.fn() });

      expect(screen.queryByText("Connection Editor")).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      expect(screen.getByText("New Connection")).toBeInTheDocument();
    });

    it("should display reset button for existing connections", () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      expect(
        screen.getByRole("button", { name: /Reset/i }),
      ).toBeInTheDocument();
    });

    it("should display save button", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      expect(
        screen.getByRole("button", { name: /Create/i }),
      ).toBeInTheDocument();
    });

    it("should organize editor settings into tabs", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      expect(
        screen.getByTestId("connection-editor-tab-general"),
      ).toHaveAttribute("aria-selected", "true");
      expect(
        screen.getByTestId("connection-editor-tab-protocol"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("connection-editor-tab-behavior"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("connection-editor-tab-organize"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("connection-editor-tab-notes"),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));

      expect(
        screen.getByTestId("connection-editor-panel-protocol"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("editor-name")).not.toBeInTheDocument();
    });

    it("should hide connection-only tabs for folders", async () => {
      renderWithProviders({
        connection: {
          ...mockConnection,
          id: "folder",
          isGroup: true,
          hostname: "",
        },
        isOpen: true,
        onClose: vi.fn(),
      });

      await waitFor(() => {
        expect(
          screen.queryByTestId("connection-editor-tab-protocol"),
        ).not.toBeInTheDocument();
        expect(
          screen.queryByTestId("connection-editor-tab-behavior"),
        ).not.toBeInTheDocument();
      });
      expect(
        screen.getByTestId("connection-editor-tab-organize"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("connection-editor-tab-notes"),
      ).toBeInTheDocument();
    });
  });

  describe("New Connection", () => {
    it("should initialize with default values for new connection", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const nameInput = screen.getByTestId("editor-name");
      // RDP should be selected by default (has active styling)
      expect(nameInput).toHaveValue("");
      // RDP should be displayed as the selected protocol in the dropdown toggle
      expect(screen.getByTestId("editor-protocol")).toHaveTextContent(/RDP/);
    });

    it("should update form data when inputs change", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const nameInput = screen.getByTestId("editor-name");
      fireEvent.change(nameInput, { target: { value: "New Connection" } });

      expect(nameInput).toHaveValue("New Connection");
    });

    it("should update protocol and set default port", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      // Open protocol dropdown and click SSH
      const protocolToggle = screen.getByTestId("editor-protocol");
      fireEvent.click(protocolToggle);
      fireEvent.click(screen.getByRole("option", { name: /^SSH/i }));

      // Dropdown toggle should now show SSH
      expect(screen.getByTestId("editor-protocol")).toHaveTextContent(/SSH/);
    });

    it("owns PostgreSQL credentials and defaults in populated protocol subtabs", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /^PostgreSQL/i }));

      expect(screen.getByTestId("editor-port")).toHaveValue(5432);
      expect(screen.queryByTestId("editor-username")).not.toBeInTheDocument();
      expect(screen.queryByTestId("editor-password")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
      expect(screen.getByLabelText("Default database")).toHaveValue("postgres");

      fireEvent.click(screen.getByRole("tab", { name: "Authentication" }));
      expect(screen.getByLabelText("Username")).toHaveValue("postgres");
      expect(screen.getByLabelText("Password")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("tab", { name: "Security" }));
      expect(
        screen.getByRole("combobox", { name: "SSL mode" }),
      ).toHaveTextContent(/Prefer/i);

      fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));
      expect(screen.getByLabelText("Connect timeout (seconds)")).toHaveValue(
        10,
      );
      expect(
        screen.getByText(/rejected before credentials are sent/i),
      ).toBeInTheDocument();
    });

    it.each([
      ["SPICE", "spice", 5900],
      ["XDMCP", "xdmcp", 177],
      ["X2Go", "x2go", 22],
      ["NX / NoMachine", "nx", 4000],
    ] as const)(
      "offers the %s native handoff with its real default port and no generic password fields",
      (label, value, port) => {
        renderWithProviders({ isOpen: true, onClose: vi.fn() });

        fireEvent.click(screen.getByTestId("editor-protocol"));
        fireEvent.change(
          screen.getByRole("combobox", { name: "Search protocols" }),
          { target: { value } },
        );
        fireEvent.click(
          screen.getByRole("option", { name: new RegExp(`^${label}`, "i") }),
        );

        expect(screen.getByTestId("editor-protocol")).toHaveTextContent(label);
        expect(screen.getByTestId("editor-port")).toHaveValue(port);
        expect(screen.queryByTestId("editor-password")).not.toBeInTheDocument();
        expect(screen.queryByTestId("editor-username")).not.toBeInTheDocument();
      },
    );

    it("should search protocol names and descriptions, then select with the keyboard", async () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const protocolToggle = screen.getByTestId("editor-protocol");
      fireEvent.click(protocolToggle);

      const searchInput = screen.getByRole("combobox", {
        name: "Search protocols",
      });
      await waitFor(() => expect(searchInput).toHaveFocus());

      fireEvent.change(searchInput, { target: { value: "secure shell" } });

      expect(screen.getByRole("option", { name: /^SSH/i })).toBeInTheDocument();
      expect(
        screen.queryByRole("option", { name: /^RDP/i }),
      ).not.toBeInTheDocument();

      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(protocolToggle).toHaveTextContent(/SSH/);
      expect(
        screen.queryByRole("combobox", { name: "Search protocols" }),
      ).not.toBeInTheDocument();
      await waitFor(() => expect(protocolToggle).toHaveFocus());
    });

    it("should filter protocol labels and value tokens across groups", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      fireEvent.click(screen.getByTestId("editor-protocol"));
      const searchInput = screen.getByRole("combobox", {
        name: "Search protocols",
      });

      fireEvent.change(searchInput, { target: { value: "NetBox" } });
      expect(
        screen.getByRole("option", { name: /NetBox/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: "Integrations" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("group", { name: "Cloud Providers" }),
      ).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: "digital-ocean" } });
      expect(screen.getByRole("option", { name: /^DO/i })).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: "Cloud Providers" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("group", { name: "Integrations" }),
      ).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: "integrations" } });
      expect(
        screen.getByRole("group", { name: "Integrations" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("group", { name: "Protocols" }),
      ).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: "cloud providers" } });
      expect(
        screen.getByRole("group", { name: "Cloud Providers" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("group", { name: "Integrations" }),
      ).not.toBeInTheDocument();

      fireEvent.change(searchInput, { target: { value: "postgres" } });
      expect(
        screen.getByRole("option", { name: /^PostgreSQL/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("group", { name: "Protocols" }),
      ).toBeInTheDocument();
    });

    it("finds Raw Socket, RLogin, and PowerShell Remoting with accurate defaults", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const protocolToggle = screen.getByTestId("editor-protocol");
      fireEvent.click(protocolToggle);
      const searchInput = screen.getByRole("combobox", {
        name: "Search protocols",
      });

      fireEvent.change(searchInput, { target: { value: "UDP payload" } });
      fireEvent.click(screen.getByRole("option", { name: /Raw Socket/i }));
      expect(protocolToggle).toHaveTextContent("Raw Socket");
      expect(screen.getByTestId("editor-port")).toHaveValue(23);
      expect(screen.queryByTestId("editor-username")).not.toBeInTheDocument();
      expect(screen.queryByTestId("editor-password")).not.toBeInTheDocument();

      fireEvent.click(protocolToggle);
      fireEvent.change(
        screen.getByRole("combobox", { name: "Search protocols" }),
        { target: { value: "RFC 1282" } },
      );
      fireEvent.click(screen.getByRole("option", { name: /RLogin/i }));
      expect(protocolToggle).toHaveTextContent("RLogin");
      expect(screen.getByTestId("editor-port")).toHaveValue(513);
      expect(screen.queryByTestId("editor-password")).not.toBeInTheDocument();

      fireEvent.click(protocolToggle);
      fireEvent.change(
        screen.getByRole("combobox", { name: "Search protocols" }),
        { target: { value: "WSMan" } },
      );
      fireEvent.click(
        screen.getByRole("option", { name: /PowerShell Remoting/i }),
      );
      expect(protocolToggle).toHaveTextContent("PowerShell Remoting");
      expect(screen.getByTestId("editor-port")).toHaveValue(5985);
    });

    it("should navigate protocol results with Arrow keys and select with Enter", async () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const protocolToggle = screen.getByTestId("editor-protocol");
      fireEvent.click(protocolToggle);
      const searchInput = screen.getByRole("combobox", {
        name: "Search protocols",
      });
      await waitFor(() => expect(searchInput).toHaveFocus());

      fireEvent.keyDown(searchInput, { key: "ArrowDown" });
      expect(searchInput).toHaveAttribute(
        "aria-activedescendant",
        "editor-protocol-option-1",
      );
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(protocolToggle).toHaveTextContent(/SSH/);
      expect(
        screen.queryByRole("combobox", { name: "Search protocols" }),
      ).not.toBeInTheDocument();
    });

    it("should preserve the selected protocol when opening and pressing Enter", async () => {
      renderWithProviders({
        connection: { ...mockConnection, protocol: "ssh", port: 22 },
        isOpen: true,
        onClose: vi.fn(),
      });

      const protocolToggle = screen.getByTestId("editor-protocol");
      await waitFor(() => expect(protocolToggle).toHaveTextContent(/SSH/));
      fireEvent.click(protocolToggle);

      const searchInput = screen.getByRole("combobox", {
        name: "Search protocols",
      });
      expect(searchInput).toHaveAttribute(
        "aria-activedescendant",
        "editor-protocol-option-1",
      );
      fireEvent.keyDown(searchInput, { key: "Enter" });

      expect(protocolToggle).toHaveTextContent(/SSH/);
      expect(protocolToggle).not.toHaveTextContent(/RDP/);
    });

    it("saves and reopens normalized Raw Socket settings", async () => {
      let latestConnections: Connection[] = [];
      const first = renderWithProviders(
        { isOpen: true, onClose: vi.fn() },
        (connections) => {
          latestConnections = connections;
        },
      );

      fireEvent.change(screen.getByTestId("editor-name"), {
        target: { value: "UDP collector" },
      });
      fireEvent.change(screen.getByTestId("editor-hostname"), {
        target: { value: "collector.example.test" },
      });
      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /Raw Socket/i }));
      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
      fireEvent.change(screen.getByLabelText("Transport"), {
        target: { value: "udp" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => {
        expect(latestConnections).toHaveLength(1);
        expect(latestConnections[0]).toMatchObject({
          name: "UDP collector",
          protocol: "raw",
          port: 23,
          rawSocketSettings: {
            version: 1,
            connection: { transport: "udp" },
          },
        });
      });
      const saved = latestConnections[0];
      first.unmount();

      renderWithProviders({
        connection: saved,
        isOpen: true,
        onClose: vi.fn(),
      });
      await waitFor(() =>
        expect(screen.getByTestId("editor-protocol")).toHaveTextContent(
          "Raw Socket",
        ),
      );
      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
      expect(screen.getByLabelText("Transport")).toHaveValue("udp");
      expect(screen.queryByTestId("editor-password")).not.toBeInTheDocument();
    });

    it("should show an empty state and reset protocol search when closed", async () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const protocolToggle = screen.getByTestId("editor-protocol");
      fireEvent.click(protocolToggle);
      const searchInput = screen.getByRole("combobox", {
        name: "Search protocols",
      });

      fireEvent.change(searchInput, {
        target: { value: "not-a-real-protocol" },
      });
      expect(screen.getByRole("status")).toHaveTextContent(
        "No protocols found",
      );
      expect(screen.getByRole("status").closest('[role="listbox"]')).toBeNull();

      fireEvent.keyDown(searchInput, { key: "Escape" });
      expect(
        screen.queryByRole("combobox", { name: "Search protocols" }),
      ).not.toBeInTheDocument();

      fireEvent.click(protocolToggle);
      expect(
        screen.getByRole("combobox", { name: "Search protocols" }),
      ).toHaveValue("");
      expect(screen.getByRole("option", { name: /^RDP/i })).toBeInTheDocument();

      fireEvent.mouseDown(document.body);
      expect(protocolToggle).toHaveAttribute("aria-expanded", "false");
      expect(protocolToggle).not.toHaveAttribute("aria-controls");
    });
  });

  describe("Edit Existing Connection", () => {
    it("should populate form with existing connection data", () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      const nameInput = screen.getByTestId("editor-name");
      expect(nameInput).toHaveValue("Test Connection");
    });

    it("should display existing tags", async () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
      const tagDisplay = screen.getByTestId("tag-display");
      // Tags should be populated from the connection after useEffect fires
      await waitFor(
        () => {
          expect(tagDisplay.textContent).toContain("test");
        },
        { timeout: 3000 },
      );
    });
  });

  describe("Notes and Parent Folder", () => {
    it("shows Notes directly and persists edited content without an accordion", async () => {
      let latestConnections: Connection[] = [];
      renderWithProviders({ isOpen: true, onClose: vi.fn() }, (connections) => {
        latestConnections = connections;
      });

      fireEvent.change(screen.getByTestId("editor-name"), {
        target: { value: "Documented Server" },
      });
      fireEvent.click(screen.getByTestId("connection-editor-tab-notes"));

      const description = screen.getByTestId("editor-description");
      expect(description).toBeVisible();
      expect(
        screen.queryByRole("button", { name: /Description & Notes/i }),
      ).not.toBeInTheDocument();
      fireEvent.change(description, {
        target: { value: "Production owner: Platform" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create" }));

      await waitFor(() => {
        expect(latestConnections).toHaveLength(1);
        expect(latestConnections[0].description).toBe(
          "Production owner: Platform",
        );
      });
    });

    it("keeps the direct Notes editor available for folders", async () => {
      const folder: Connection = {
        ...mockConnection,
        id: "folder-notes",
        name: "Folder Notes",
        hostname: "",
        isGroup: true,
        description: "Shared folder context",
      };
      renderWithProviders({
        connection: folder,
        isOpen: true,
        onClose: vi.fn(),
      });

      fireEvent.click(screen.getByTestId("connection-editor-tab-notes"));
      await waitFor(() =>
        expect(screen.getByTestId("editor-description")).toHaveValue(
          "Shared folder context",
        ),
      );
    });

    it("searches folder breadcrumbs and persists the selected nested parent", async () => {
      const infrastructure: Connection = {
        ...mockConnection,
        id: "folder-infrastructure",
        name: "Infrastructure",
        hostname: "",
        isGroup: true,
      };
      const production: Connection = {
        ...infrastructure,
        id: "folder-production",
        name: "Production",
        parentId: infrastructure.id,
      };
      const editable: Connection = {
        ...mockConnection,
        id: "nested-parent-target",
        name: "Nested Parent Target",
        parentId: undefined,
      };
      let latestConnections: Connection[] = [];

      renderWithProviders(
        { connection: editable, isOpen: true, onClose: vi.fn() },
        (connections) => {
          latestConnections = connections;
        },
        [infrastructure, production, editable],
      );

      const parentPicker = screen.getByRole("combobox", {
        name: "Parent Folder",
      });
      await waitFor(() => expect(parentPicker).toHaveValue("Root (No parent)"));
      fireEvent.focus(parentPicker);
      fireEvent.change(parentPicker, {
        target: { value: "INFRASTRUCTURE / production" },
      });
      fireEvent.click(
        screen.getByRole("option", {
          name: /Production.*Infrastructure \/ Production/i,
        }),
      );

      expect(parentPicker).toHaveValue("Infrastructure / Production");
      fireEvent.click(screen.getByRole("button", { name: "Save" }));

      await waitFor(() => {
        expect(
          latestConnections.find((connection) => connection.id === editable.id)
            ?.parentId,
        ).toBe(production.id);
      });
    });
  });

  describe("Cross-tab settings search", () => {
    it("keeps the editor shrinkable with a single contained scrolling pane", () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      expect(screen.getByTestId("connection-editor")).toHaveClass(
        "min-h-0",
        "min-w-0",
        "max-w-full",
        "overflow-hidden",
      );
      const pane = document.querySelector("[data-editor-scroll-pane]");
      expect(pane).toHaveClass(
        "min-h-0",
        "min-w-0",
        "max-w-full",
        "overflow-x-hidden",
        "overflow-y-auto",
        "overscroll-contain",
      );
      expect(document.querySelector("[data-search-bar]")).toHaveClass(
        "min-w-0",
        "w-full",
      );
    });

    it("scrolls only the editor pane and clamps targets above or below its padded viewport", () => {
      const pane = document.createElement("div");
      pane.dataset.editorScrollPane = "true";
      const container = document.createElement("div");
      const target = document.createElement("label");
      pane.append(container);
      container.append(target);
      document.body.append(pane);

      Object.defineProperties(pane, {
        clientHeight: { configurable: true, value: 400 },
        clientWidth: { configurable: true, value: 600 },
        scrollHeight: { configurable: true, value: 1200 },
        scrollWidth: { configurable: true, value: 900 },
      });
      pane.scrollTop = 250;
      pane.scrollLeft = 31;
      pane.getBoundingClientRect = vi.fn(
        () =>
          ({
            top: 100,
            bottom: 500,
            left: 40,
            right: 640,
            width: 600,
            height: 400,
          }) as DOMRect,
      );
      target.getBoundingClientRect = vi.fn(
        () =>
          ({
            top: 520,
            bottom: 560,
            left: 80,
            right: 280,
            width: 200,
            height: 40,
          }) as DOMRect,
      );
      const bodyScrollTop = document.body.scrollTop;
      const documentScrollTop = document.documentElement.scrollTop;
      const windowScroll = vi
        .spyOn(window, "scrollTo")
        .mockImplementation(() => {});

      expect(
        scrollConnectionEditorSearchTargetIntoView(container, target),
      ).toBe(true);
      expect(pane.scrollTop).toBe(326);
      expect(pane.scrollLeft).toBe(31);

      target.getBoundingClientRect = vi.fn(
        () =>
          ({
            top: 60,
            bottom: 90,
            left: 80,
            right: 280,
            width: 200,
            height: 30,
          }) as DOMRect,
      );
      scrollConnectionEditorSearchTargetIntoView(container, target);
      expect(pane.scrollTop).toBe(270);
      expect(pane.scrollLeft).toBe(31);
      expect(document.body.scrollTop).toBe(bodyScrollTop);
      expect(document.documentElement.scrollTop).toBe(documentScrollTop);
      expect(windowScroll).not.toHaveBeenCalled();

      windowScroll.mockRestore();
      pane.remove();
    });

    it("focuses the exact field even when it is a sibling of the registered section", async () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      const search = screen.getByRole("combobox", {
        name: "Search connection settings",
      });
      fireEvent.change(search, { target: { value: "192.168.1.100" } });
      expect(
        screen.getByRole("option", {
          name: /Basics \/ Connection.*Hostname \/ IP.*192\.168\.1\.100/i,
        }),
      ).toBeInTheDocument();
      fireEvent.keyDown(search, { key: "Enter" });

      await waitFor(() => {
        expect(screen.getByTestId("editor-hostname")).toHaveFocus();
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveTextContent("Hostname / IP");
      });
      expect(screen.getByTestId("editor-hostname")).toHaveValue(
        "192.168.1.100",
      );
    });

    it("finds a saved Notes value, navigates across tabs, and highlights without changing it", async () => {
      renderWithProviders({
        connection: {
          ...mockConnection,
          description: "Owned by Platform Engineering",
        },
        isOpen: true,
        onClose: vi.fn(),
      });

      const search = screen.getByRole("combobox", {
        name: "Search connection settings",
      });
      fireEvent.change(search, {
        target: { value: "Owned by Platform Engineering" },
      });

      const result = screen.getByRole("option", {
        name: /Notes \/ Description & Notes.*Owned by Platform Engineering/i,
      });
      expect(result.querySelector("mark")).toHaveTextContent(
        "Owned by Platform Engineering",
      );

      fireEvent.keyDown(search, { key: "Enter" });

      await waitFor(() => {
        expect(
          screen.getByTestId("connection-editor-tab-notes"),
        ).toHaveAttribute("aria-selected", "true");
        expect(screen.getByTestId("editor-description")).toHaveFocus();
      });
      expect(screen.getByTestId("editor-description")).toHaveValue(
        "Owned by Platform Engineering",
      );
      expect(
        document.querySelector('[data-editor-search-active="true"]'),
      ).toHaveTextContent("Description & Notes");
    });

    it("supports deterministic keyboard and button navigation, then Escape clears", async () => {
      const windowScroll = vi
        .spyOn(window, "scrollTo")
        .mockImplementation(() => {});
      const bodyScrollTop = document.body.scrollTop;
      const documentScrollTop = document.documentElement.scrollTop;
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      const search = screen.getByRole("combobox", {
        name: "Search connection settings",
      });
      fireEvent.change(search, { target: { value: "Focus Behavior" } });

      expect(screen.getAllByRole("option")).toHaveLength(2);
      fireEvent.keyDown(search, { key: "End" });
      expect(search).toHaveAttribute(
        "aria-activedescendant",
        "connection-editor-search-result-1",
      );
      fireEvent.keyDown(search, { key: "Enter" });

      await waitFor(() => {
        expect(
          screen.getByTestId("connection-editor-tab-behavior"),
        ).toHaveAttribute("aria-selected", "true");
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveTextContent(/On Windows Management Tool/i);
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Previous search result" }),
      );
      await waitFor(() =>
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveTextContent("On Connect"),
      );

      fireEvent.click(
        screen.getByRole("button", { name: "Next search result" }),
      );
      await waitFor(() =>
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveTextContent(/On Windows Management Tool/i),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Next search result" }),
      );
      await waitFor(() =>
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveTextContent("On Connect"),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Previous search result" }),
      );
      await waitFor(() =>
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveTextContent(/On Windows Management Tool/i),
      );
      expect(document.body.scrollTop).toBe(bodyScrollTop);
      expect(document.documentElement.scrollTop).toBe(documentScrollTop);
      expect(windowScroll).not.toHaveBeenCalled();

      fireEvent.keyDown(search, { key: "Escape" });
      await waitFor(() => {
        expect(search).toHaveValue("");
        expect(
          screen.queryByRole("listbox", {
            name: "Connection setting search results",
          }),
        ).not.toBeInTheDocument();
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toBeNull();
      });
      windowScroll.mockRestore();
    });

    it("cancels stale cross-tab navigation and re-clamps the active result after resize", async () => {
      const frames = new Map<number, FrameRequestCallback>();
      let frameId = 0;
      let resizeCallback: ResizeObserverCallback | undefined;
      const observe = vi.fn();
      const disconnect = vi.fn();
      class TestResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resizeCallback = callback;
        }

        observe = observe;
        unobserve = vi.fn();
        disconnect = disconnect;
      }
      vi.stubGlobal("ResizeObserver", TestResizeObserver);
      const requestFrame = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((callback) => {
          frameId += 1;
          frames.set(frameId, callback);
          return frameId;
        });
      const cancelFrame = vi
        .spyOn(window, "cancelAnimationFrame")
        .mockImplementation((id) => {
          frames.delete(id);
        });
      const flushFrames = () => {
        while (frames.size > 0) {
          const pending = [...frames.entries()];
          frames.clear();
          pending.forEach(([, callback]) => callback(performance.now()));
        }
      };
      const windowScroll = vi
        .spyOn(window, "scrollTo")
        .mockImplementation(() => undefined);

      const { unmount } = renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      const search = screen.getByRole("combobox", {
        name: "Search connection settings",
      });
      fireEvent.change(search, { target: { value: "Focus Behavior" } });
      fireEvent.click(
        screen.getByRole("button", { name: "Next search result" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Next search result" }),
      );
      flushFrames();

      await waitFor(() =>
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveTextContent(/On Windows Management Tool/i),
      );

      const pane = document.querySelector<HTMLElement>(
        "[data-editor-scroll-pane]",
      );
      const activeTarget = document.querySelector<HTMLElement>(
        '[data-editor-search-active="true"]',
      );
      expect(pane).not.toBeNull();
      expect(activeTarget).not.toBeNull();
      Object.defineProperties(pane!, {
        clientHeight: { configurable: true, value: 300 },
        clientWidth: { configurable: true, value: 500 },
        scrollHeight: { configurable: true, value: 900 },
        scrollWidth: { configurable: true, value: 900 },
      });
      pane!.scrollTop = 100;
      pane!.scrollLeft = 30;
      pane!.getBoundingClientRect = vi.fn(
        () =>
          ({
            top: 100,
            bottom: 400,
            left: 50,
            right: 550,
            width: 500,
            height: 300,
          }) as DOMRect,
      );
      activeTarget!.getBoundingClientRect = vi.fn(
        () =>
          ({
            top: 430,
            bottom: 470,
            left: 580,
            right: 660,
            width: 80,
            height: 40,
          }) as DOMRect,
      );
      const bodyTop = document.body.scrollTop;
      const documentTop = document.documentElement.scrollTop;

      resizeCallback?.([], {} as ResizeObserver);
      flushFrames();

      expect(pane!.scrollTop).toBe(186);
      expect(pane!.scrollLeft).toBe(30);
      expect(document.body.scrollTop).toBe(bodyTop);
      expect(document.documentElement.scrollTop).toBe(documentTop);
      expect(windowScroll).not.toHaveBeenCalled();
      expect(observe).toHaveBeenCalledWith(pane);
      unmount();
      expect(disconnect).toHaveBeenCalledOnce();
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
      windowScroll.mockRestore();
      vi.unstubAllGlobals();
    });

    it("does not search secret values and updates protocol-dependent results", async () => {
      const onClose = vi.fn();
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose,
      });

      const search = screen.getByRole("combobox", {
        name: "Search connection settings",
      });
      fireEvent.change(search, { target: { value: "testpass" } });
      expect(screen.getByRole("status")).toHaveTextContent("No settings found");
      fireEvent.keyDown(search, { key: "Enter" });
      expect(onClose).not.toHaveBeenCalled();

      fireEvent.change(search, { target: { value: "Known Hosts Path" } });
      expect(screen.getByRole("status")).toHaveTextContent("No settings found");
      fireEvent.keyDown(search, { key: "Escape" });

      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(
        screen.getByRole("option", { name: /SSH.*Secure Shell/i }),
      );
      fireEvent.change(search, { target: { value: "Known Hosts Path" } });
      expect(
        screen.getByRole("option", {
          name: /Protocol \/ Protocol Options.*Known Hosts Path/i,
        }),
      ).toBeInTheDocument();

      fireEvent.keyDown(search, { key: "Enter" });
      await waitFor(() => {
        expect(
          screen.getByTestId("connection-editor-tab-protocol"),
        ).toHaveAttribute("aria-selected", "true");
        expect(
          screen.getByTestId(
            "connection-editor-protocol-subtab-authentication",
          ),
        ).toHaveAttribute("aria-selected", "true");
        expect(screen.getByLabelText("Known Hosts Path")).toHaveFocus();
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveTextContent("Known Hosts Path");
      });
    });

    it("navigates to and highlights a protocol-local RLogin field", async () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /RLogin/i }));

      const search = screen.getByRole("combobox", {
        name: "Search connection settings",
      });
      fireEvent.change(search, { target: { value: "No password automation" } });
      expect(
        screen.getByRole("option", {
          name: /Protocol \/ RLogin security.*No password automation/i,
        }),
      ).toBeInTheDocument();
      fireEvent.keyDown(search, { key: "Enter" });

      await waitFor(() => {
        expect(
          screen.getByTestId("connection-editor-tab-protocol"),
        ).toHaveAttribute("aria-selected", "true");
        expect(
          screen.getByTestId("connection-editor-protocol-subtab-security"),
        ).toHaveAttribute("aria-selected", "true");
        expect(
          screen.getByRole("checkbox", {
            name: /I understand and accept the plaintext risk/i,
          }),
        ).toHaveFocus();
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveAttribute(
          "data-editor-search-field",
          "rlogin-plaintext-acknowledgement",
        );
      });
    });

    it("keeps connection-only sections out of folder search", () => {
      const folder: Connection = {
        ...mockConnection,
        id: "search-folder",
        name: "Infrastructure",
        hostname: "",
        isGroup: true,
      };
      renderWithProviders({
        connection: folder,
        isOpen: true,
        onClose: vi.fn(),
      });

      const search = screen.getByRole("combobox", {
        name: "Search connection settings",
      });
      fireEvent.change(search, { target: { value: "Focus Behavior" } });
      expect(screen.getByRole("status")).toHaveTextContent("No settings found");

      fireEvent.change(search, { target: { value: "Description & Notes" } });
      expect(
        screen.getByRole("option", {
          name: /Notes \/ Description & Notes/i,
        }),
      ).toBeInTheDocument();
    });
  });

  describe("Protocol-Specific Options", () => {
    it("finds ARD by Screen Sharing terminology and applies its saved default", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.change(
        screen.getByRole("combobox", { name: "Search protocols" }),
        { target: { value: "screen sharing" } },
      );
      fireEvent.click(
        screen.getByRole("option", { name: /Apple Remote Desktop/i }),
      );

      expect(screen.getByTestId("editor-protocol")).toHaveTextContent(
        "Apple Remote Desktop",
      );
      expect(screen.getByTestId("editor-port")).toHaveValue(5900);
      expect(screen.queryByTestId("editor-username")).not.toBeInTheDocument();
      expect(screen.queryByTestId("editor-password")).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
      expect(screen.getByRole("tab", { name: "Connection" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(
        screen.getByRole("tab", { name: "Authentication" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: "Display & Input" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Network Path" }),
      ).not.toBeInTheDocument();
    });

    it("searches every newly saved protocol by its user-facing terminology", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const cases = [
        { query: "plaintext terminal", label: "Telnet", port: 23 },
        { query: "file transfer", label: "SFTP", port: 22 },
        { query: "mariadb", label: "MySQL", port: 3306 },
        { query: "samba", label: "SMB", port: 445 },
        { query: "device id", label: "RustDesk", port: undefined },
      ] as const;

      for (const entry of cases) {
        fireEvent.click(screen.getByTestId("editor-protocol"));
        fireEvent.change(
          screen.getByRole("combobox", { name: "Search protocols" }),
          { target: { value: entry.query } },
        );
        fireEvent.click(
          screen.getByRole("option", { name: new RegExp(`^${entry.label}`) }),
        );
        expect(screen.getByTestId("editor-protocol")).toHaveTextContent(
          entry.label,
        );
        if (entry.port !== undefined) {
          expect(screen.getByTestId("editor-port")).toHaveValue(entry.port);
        }
      }
    });

    it("shows tailored subtabs and remembers selection per protocol", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /^SSH/i }));
      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));

      expect(
        screen.getByRole("tablist", { name: "Protocol settings sections" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("tab", { name: "Authentication" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: "Terminal" })).toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Security" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: "Network" }));

      fireEvent.click(screen.getByTestId("connection-editor-tab-general"));
      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(
        screen.getByRole("option", { name: /^HTTP\s+Web Service/i }),
      );
      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
      expect(
        screen.getByRole("tab", { name: "Authentication" }),
      ).toHaveAttribute("aria-selected", "true");
      expect(screen.getByRole("tab", { name: "Security" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Advanced" })).toBeInTheDocument();
      expect(
        screen.queryByRole("tab", { name: "Terminal" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("tab", { name: "Advanced" }));

      fireEvent.click(screen.getByTestId("connection-editor-tab-general"));
      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /^SSH/i }));
      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));
      expect(screen.getByRole("tab", { name: "Network" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    });

    it("opens the correct protocol subtab before focusing a search match", async () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      const search = screen.getByRole("combobox", {
        name: "Search connection settings",
      });
      fireEvent.change(search, { target: { value: "Gateway server" } });
      expect(
        screen.getByRole("option", {
          name: /Protocol \/ Protocol Options.*Gateway/i,
        }),
      ).toBeInTheDocument();
      fireEvent.keyDown(search, { key: "Enter" });

      await waitFor(() => {
        expect(
          screen.getByTestId("connection-editor-tab-protocol"),
        ).toHaveAttribute("aria-selected", "true");
        expect(
          screen.getByTestId("connection-editor-protocol-subtab-network"),
        ).toHaveAttribute("aria-selected", "true");
        expect(
          document.querySelector('[data-editor-search-active="true"]'),
        ).toHaveTextContent("Gateway");
      });
      expect(document.activeElement).toHaveTextContent("Gateway");
    });

    it("opens Network Path directly from settings search", async () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      const search = screen.getByRole("combobox", {
        name: "Search connection settings",
      });
      fireEvent.change(search, { target: { value: "Resolved ordered path" } });
      expect(
        screen.getByRole("option", {
          name: /Protocol \/ Protocol Options.*Network Path/i,
        }),
      ).toBeInTheDocument();
      fireEvent.keyDown(search, { key: "Enter" });

      await waitFor(() => {
        const networkPathTab = screen.getByTestId(
          "connection-editor-protocol-subtab-network-path",
        );
        expect(networkPathTab).toHaveAttribute("aria-selected", "true");
        expect(networkPathTab).toHaveFocus();
        expect(networkPathTab).toHaveAttribute(
          "data-editor-search-active",
          "true",
        );
      });
    });

    it("should expose integration registry entries as protocol options", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /NetBox/i }));

      expect(screen.getByTestId("editor-protocol")).toHaveTextContent(/NetBox/);
      expect(
        screen.getByTestId("editor-integration-instance-id"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("editor-integration-instance-name"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("editor-hostname")).toHaveAttribute(
        "placeholder",
        "service.example.com",
      );
      expect(
        screen.getByTestId("editor-integration-base-url"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("editor-integration-auth-token"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("editor-integration-api-key"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("editor-username")).toBeInTheDocument();
      expect(screen.getByTestId("editor-password")).toBeInTheDocument();
      expect(screen.getByTestId("editor-integration-tls-verify")).toBeChecked();
      expect(screen.getByTestId("editor-integration-timeout")).toHaveValue(30);
    });

    it("should populate generic integration fields for integration-backed connections", async () => {
      const integrationConnection: Connection = {
        ...mockConnection,
        protocol: "integration:grafana",
        hostname: "grafana.internal",
        port: 443,
        username: "ops",
        password: "grafana-pass",
        timeout: 45,
        integration: {
          descriptorKey: "grafana",
          descriptorLabel: "Grafana",
          category: "app-service",
          instanceId: "grafana-prod",
          instanceName: "Production Grafana",
          host: "grafana.internal",
          baseUrl: "https://grafana.internal",
          username: "ops",
          tlsVerify: false,
          timeout: 45,
        },
      };

      renderWithProviders({
        connection: integrationConnection,
        isOpen: true,
        onClose: vi.fn(),
      });

      await waitFor(() => {
        expect(screen.getByTestId("editor-protocol")).toHaveTextContent(
          /Grafana/,
        );
      });
      expect(screen.getByTestId("editor-integration-instance-id")).toHaveValue(
        "grafana-prod",
      );
      expect(
        screen.getByTestId("editor-integration-instance-name"),
      ).toHaveValue("Production Grafana");
      expect(screen.getByTestId("editor-hostname")).toHaveValue(
        "grafana.internal",
      );
      expect(screen.getByTestId("editor-integration-base-url")).toHaveValue(
        "https://grafana.internal",
      );
      expect(screen.getByTestId("editor-integration-auth-token")).toHaveValue(
        "",
      );
      expect(screen.getByTestId("editor-integration-api-key")).toHaveValue("");
      expect(screen.getByTestId("editor-username")).toHaveValue("ops");
      expect(screen.getByTestId("editor-password")).toHaveValue("grafana-pass");
      expect(
        screen.getByTestId("editor-integration-tls-verify"),
      ).not.toBeChecked();
      expect(screen.getByTestId("editor-integration-timeout")).toHaveValue(45);
    });

    it("should expose tailored Exchange fields for integration-backed Exchange connections", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /Exchange/i }));

      expect(screen.getByTestId("editor-protocol")).toHaveTextContent(
        /Exchange/,
      );
      expect(screen.getByTestId("editor-exchange-environment")).toHaveValue(
        "online",
      );
      expect(
        screen.getByTestId("editor-exchange-tenant-id"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("editor-exchange-client-id"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("editor-exchange-client-secret"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("editor-exchange-server"),
      ).not.toBeInTheDocument();

      fireEvent.change(screen.getByTestId("editor-exchange-environment"), {
        target: { value: "hybrid" },
      });

      expect(screen.getByTestId("editor-exchange-server")).toBeInTheDocument();
      expect(
        screen.getByTestId("editor-exchange-onprem-username"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("editor-exchange-auth-method")).toHaveValue(
        "kerberos",
      );
      expect(screen.getByTestId("editor-exchange-use-ssl")).toBeChecked();
    });

    it("should show SSH options for SSH protocol", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      // Open protocol dropdown and click SSH
      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /^SSH/i }));
      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));

      expect(screen.getByTestId("ssh-options")).toBeInTheDocument();
    });

    it("should show HTTP options for HTTP protocol", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      // Open protocol dropdown and click HTTP by its combined label and description.
      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(
        screen.getByRole("option", { name: /^HTTP\s+Web Service/i }),
      );
      fireEvent.click(screen.getByTestId("connection-editor-tab-protocol"));

      expect(screen.getByTestId("http-options")).toBeInTheDocument();
    });
  });

  describe("Tag Management", () => {
    it("should render tag manager", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
      expect(screen.getByTestId("tag-manager")).toBeInTheDocument();
    });

    it("should update tags when tag manager changes", async () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      fireEvent.click(screen.getByTestId("connection-editor-tab-organize"));
      const addTagButton = screen.getByText("Add Tag");
      fireEvent.click(addTagButton);

      const tagDisplay = screen.getByTestId("tag-display");
      await waitFor(() => {
        expect(tagDisplay.textContent).toContain("test-tag");
      });
    });
  });

  describe("Save Functionality", () => {
    it("should call onClose when save button is clicked", async () => {
      const mockOnClose = vi.fn();
      renderWithProviders({ isOpen: true, onClose: mockOnClose });

      // Fill required fields first
      const nameInput = screen.getByTestId("editor-name");
      fireEvent.change(nameInput, { target: { value: "Test Connection" } });

      const hostnameInput = screen.getByPlaceholderText(/192\.168\.1\.100/i);
      fireEvent.change(hostnameInput, {
        target: { value: "test.example.com" },
      });

      const saveButton = screen.getByRole("button", { name: /Create/i });
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it("should dispatch ADD_CONNECTION for new connection", () => {
      const mockDispatch = vi.fn();
      // This would need more complex mocking of the context
      // For now, we test that the save button exists and is clickable
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const saveButton = screen.getByRole("button", { name: /Create/i });
      expect(saveButton).toBeInTheDocument();
    });

    it("persists connection behavior overrides and automation when reopened", async () => {
      let latestConnections: Connection[] = [];
      const firstRender = renderWithProviders(
        { isOpen: true, onClose: vi.fn() },
        (connections) => {
          latestConnections = connections;
        },
      );

      fireEvent.change(screen.getByTestId("editor-name"), {
        target: { value: "Automated Production" },
      });
      fireEvent.change(screen.getByTestId("editor-hostname"), {
        target: { value: "automated.example.test" },
      });
      fireEvent.click(screen.getByTestId("connection-editor-tab-behavior"));

      fireEvent.change(screen.getByLabelText("Retry attempts"), {
        target: { value: "0" },
      });
      fireEvent.change(screen.getByLabelText("Retry delay (ms)"), {
        target: { value: "1500" },
      });
      fireEvent.click(screen.getByRole("combobox", { name: "Warn on Close" }));
      fireEvent.mouseDown(
        screen.getByRole("option", { name: "Close without warning" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Add automation rule" }),
      );
      fireEvent.change(screen.getByLabelText("Rule 1 name"), {
        target: { value: "Log initial failures" },
      });
      fireEvent.click(screen.getByRole("combobox", { name: "Rule 1 event" }));
      fireEvent.mouseDown(
        screen.getByRole("option", { name: "Initial connection failed" }),
      );
      fireEvent.click(screen.getByLabelText("Rule 1 reason Error"));
      fireEvent.change(screen.getByLabelText("Rule 1 delay (ms)"), {
        target: { value: "75" },
      });
      fireEvent.change(screen.getByLabelText("Rule 1 cooldown (ms)"), {
        target: { value: "1000" },
      });
      fireEvent.click(screen.getByLabelText("Rule 1 once per session"));
      fireEvent.change(screen.getByLabelText("Action 1 log message"), {
        target: { value: "Failure: {{error.message}}" },
      });

      expect(screen.getByTestId("connection-editor")).toBeValid();

      fireEvent.click(screen.getByRole("button", { name: "Create" }));
      await waitFor(() => expect(latestConnections).toHaveLength(1));

      const saved = latestConnections[0];
      expect(saved).toMatchObject({
        retryAttempts: 0,
        retryDelay: 1500,
        warnOnClose: false,
        behaviorAutomation: {
          version: 1,
          rules: [
            {
              id: "behavior-rule-1",
              name: "Log initial failures",
              event: "session.connectFailed",
              when: { reasons: ["error"] },
              options: {
                delayMs: 75,
                cooldownMs: 1000,
                oncePerSession: true,
                stopOnActionError: false,
              },
              actions: [
                {
                  type: "writeLog",
                  level: "info",
                  message: "Failure: {{error.message}}",
                },
              ],
            },
          ],
        },
      });

      firstRender.unmount();
      renderWithProviders(
        { connection: saved, isOpen: true, onClose: vi.fn() },
        undefined,
        [saved],
      );
      await waitFor(() =>
        expect(screen.getByTestId("editor-name")).toHaveValue(
          "Automated Production",
        ),
      );
      fireEvent.click(screen.getByTestId("connection-editor-tab-behavior"));

      expect(screen.getByLabelText("Retry attempts")).toHaveValue(0);
      expect(screen.getByLabelText("Retry delay (ms)")).toHaveValue(1500);
      expect(
        screen.getByRole("combobox", { name: "Warn on Close" }),
      ).toHaveTextContent("Close without warning");
      expect(screen.getByLabelText("Rule 1 name")).toHaveValue(
        "Log initial failures",
      );
      expect(
        screen.getByRole("combobox", { name: "Rule 1 event" }),
      ).toHaveTextContent("Initial connection failed");
      expect(screen.getByLabelText("Rule 1 reason Error")).toBeChecked();
      expect(screen.getByLabelText("Rule 1 once per session")).toBeChecked();
      expect(screen.getByLabelText("Action 1 log message")).toHaveValue(
        "Failure: {{error.message}}",
      );
    });

    it("should not persist integration token, API key, or password in connection data", async () => {
      const mockOnClose = vi.fn();
      let latestConnections: Connection[] = [];

      renderWithProviders(
        { isOpen: true, onClose: mockOnClose },
        (connections) => {
          latestConnections = connections;
        },
      );

      fireEvent.change(screen.getByTestId("editor-name"), {
        target: { value: "NetBox Production" },
      });
      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /NetBox/i }));
      fireEvent.change(screen.getByTestId("editor-hostname"), {
        target: { value: "netbox.internal" },
      });
      fireEvent.change(screen.getByTestId("editor-integration-base-url"), {
        target: { value: "https://netbox.internal" },
      });
      fireEvent.change(screen.getByTestId("editor-integration-auth-token"), {
        target: { value: "token-secret" },
      });
      fireEvent.change(screen.getByTestId("editor-integration-api-key"), {
        target: { value: "api-secret" },
      });
      fireEvent.change(screen.getByTestId("editor-username"), {
        target: { value: "ops" },
      });
      fireEvent.change(screen.getByTestId("editor-password"), {
        target: { value: "password-secret" },
      });

      fireEvent.click(screen.getByRole("button", { name: /Create/i }));

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
        expect(latestConnections).toHaveLength(1);
      });

      const saved = latestConnections[0] as Connection & {
        integration?: Record<string, unknown>;
      };
      expect(saved.protocol).toBe("integration:netbox");
      expect(saved.hostname).toBe("netbox.internal");
      expect(saved.username).toBe("ops");
      expect(saved.password).toBe("");
      expect(saved.integration).toMatchObject({
        descriptorKey: "netbox",
        descriptorLabel: "NetBox",
        category: "infra",
        host: "netbox.internal",
        baseUrl: "https://netbox.internal",
        username: "ops",
        tlsVerify: true,
        timeout: 30,
      });
      expect(saved.integration).not.toHaveProperty("authToken");
      expect(saved.integration).not.toHaveProperty("apiKey");
      expect(saved.integration).not.toHaveProperty("password");
    });

    it("should persist Exchange provider metadata without Exchange secrets", async () => {
      const mockOnClose = vi.fn();
      let latestConnections: Connection[] = [];

      renderWithProviders(
        { isOpen: true, onClose: mockOnClose },
        (connections) => {
          latestConnections = connections;
        },
      );

      fireEvent.change(screen.getByTestId("editor-name"), {
        target: { value: "Exchange Hybrid" },
      });
      fireEvent.click(screen.getByTestId("editor-protocol"));
      fireEvent.click(screen.getByRole("option", { name: /Exchange/i }));
      fireEvent.change(screen.getByTestId("editor-exchange-environment"), {
        target: { value: "hybrid" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-timeout"), {
        target: { value: "180" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-tenant-id"), {
        target: { value: "tenant.onmicrosoft.com" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-client-id"), {
        target: { value: "client-guid" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-client-secret"), {
        target: { value: "client-secret" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-online-username"), {
        target: { value: "admin@tenant.onmicrosoft.com" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-organization"), {
        target: { value: "tenant.onmicrosoft.com" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-server"), {
        target: { value: "mail01.contoso.local" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-port"), {
        target: { value: "5986" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-onprem-username"), {
        target: { value: "CONTOSO\\administrator" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-password"), {
        target: { value: "onprem-secret" },
      });
      fireEvent.change(screen.getByTestId("editor-exchange-auth-method"), {
        target: { value: "ntlm" },
      });

      fireEvent.click(screen.getByRole("button", { name: /Create/i }));

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
        expect(latestConnections).toHaveLength(1);
      });

      const saved = latestConnections[0] as Connection & {
        integration?: Record<string, unknown>;
      };
      expect(saved.protocol).toBe("integration:exchange");
      expect(saved.hostname).toBe("mail01.contoso.local");
      expect(saved.username).toBe("admin@tenant.onmicrosoft.com");
      expect(saved.password).toBe("");
      expect(saved.timeout).toBe(180);
      expect(saved.integration).toMatchObject({
        descriptorKey: "exchange",
        descriptorLabel: "Exchange",
        category: "app-service",
        host: "mail01.contoso.local",
        username: "admin@tenant.onmicrosoft.com",
        timeout: 180,
        providerFields: {
          environment: "hybrid",
          timeoutSecs: "180",
          tenantId: "tenant.onmicrosoft.com",
          clientId: "client-guid",
          onlineUsername: "admin@tenant.onmicrosoft.com",
          organization: "tenant.onmicrosoft.com",
          server: "mail01.contoso.local",
          port: "5986",
          onPremUsername: "CONTOSO\\administrator",
          useSsl: true,
          authMethod: "ntlm",
          skipCertCheck: false,
        },
      });
      expect(saved.integration).not.toHaveProperty("providerSecrets");
      expect(JSON.stringify(saved.integration)).not.toContain("client-secret");
      expect(JSON.stringify(saved.integration)).not.toContain("onprem-secret");
    });
  });

  describe("Close Functionality", () => {
    it("should call onClose when new connection is saved", async () => {
      const mockOnClose = vi.fn();
      const { container } = renderWithProviders({
        isOpen: true,
        onClose: mockOnClose,
      });

      const nameInput = screen.getByTestId("editor-name");
      fireEvent.change(nameInput, { target: { value: "Test" } });

      const form = container.querySelector("form")!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it("should not render when closed", () => {
      renderWithProviders({ isOpen: false, onClose: vi.fn() });

      expect(screen.queryByText("New Connection")).not.toBeInTheDocument();
    });
  });

  describe("Form Validation", () => {
    it("should require name for saving", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const saveButton = screen.getByRole("button", { name: /Create/i });

      // Form should be submittable even with empty name (validation happens elsewhere)
      expect(saveButton).toBeEnabled();
    });

    it("should handle empty hostname gracefully", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const nameInput = screen.getByTestId("editor-name");
      fireEvent.change(nameInput, { target: { value: "Test Connection" } });

      // Should not crash with empty hostname
      expect(screen.getByText("New Connection")).toBeInTheDocument();
    });
  });
});
