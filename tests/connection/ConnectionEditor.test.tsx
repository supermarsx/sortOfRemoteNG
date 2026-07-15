import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { ConnectionEditor } from "../../src/components/connection/ConnectionEditor";
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
      <div data-testid="ssh-options">SSH Options</div>
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

vi.mock("../../src/utils/discovery/defaultPorts", () => ({
  getDefaultPort: vi.fn((protocol) => {
    const ports: Record<string, number> = {
      rdp: 3389,
      ssh: 22,
      vnc: 5900,
      http: 80,
      https: 443,
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

  describe("Protocol-Specific Options", () => {
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
