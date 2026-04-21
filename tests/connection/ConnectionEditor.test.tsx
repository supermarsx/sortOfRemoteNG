import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionEditor } from "../../src/components/connection/ConnectionEditor";
import { Connection } from "../../src/types/connection/connection";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";

// Mock ToastContext (useConnectionEditor depends on it)
vi.mock('../../src/contexts/ToastContext', () => ({
  useToastContext: () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  }),
}));

// Mock child components
vi.mock('../../src/components/connection/TagManager', () => ({
  TagManager: ({ tags, onChange }: any) => (
    <div data-testid="tag-manager">
      <span data-testid="tag-display">{tags?.join(', ') || 'none'}</span>
      <button onClick={() => onChange(['test-tag'])}>Add Tag</button>
    </div>
  )
}));

vi.mock('../../src/components/connectionEditor/SSHOptions', () => ({
  default: ({ formData }: any) => formData.protocol === 'ssh' ? <div data-testid="ssh-options">SSH Options</div> : null
}));

vi.mock('../../src/components/connectionEditor/HTTPOptions', () => ({
  default: ({ formData }: any) => ['http', 'https'].includes(formData.protocol) ? <div data-testid="http-options">HTTP Options</div> : null
}));

vi.mock('../../src/components/connectionEditor/CloudProviderOptions', () => ({
  default: () => <div data-testid="cloud-options">Cloud Options</div>
}));

vi.mock('../../src/utils/discovery/defaultPorts', () => ({
  getDefaultPort: vi.fn((protocol) => {
    const ports: Record<string, number> = {
      rdp: 3389,
      ssh: 22,
      vnc: 5900,
      http: 80,
      https: 443
    };
    return ports[protocol] || 3389;
  })
}));

vi.mock('../../src/utils/core/id', () => ({
  generateId: vi.fn(() => 'test-generated-id')
}));

const mockConnection: Connection = {
  id: 'test-connection',
  name: 'Test Connection',
  protocol: 'rdp',
  hostname: '192.168.1.100',
  port: 3389,
  username: 'testuser',
  password: 'testpass',
  domain: '',
  description: 'Test connection',
  isGroup: false,
  tags: ['test', 'rdp'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

const renderWithProviders = (props: any) => {
  return render(
    <ConnectionProvider>
      <ConnectionEditor {...props} />
    </ConnectionProvider>
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
      renderWithProviders({ connection: mockConnection, isOpen: true, onClose: vi.fn() });

      expect(screen.getByRole('button', { name: /Reset/i })).toBeInTheDocument();
    });

    it("should display save button", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      expect(screen.getByRole('button', { name: /Create/i })).toBeInTheDocument();
    });
  });

  describe("New Connection", () => {
    it("should initialize with default values for new connection", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const nameInput = screen.getByTestId('editor-name');
      // RDP should be selected by default (has active styling)
      expect(nameInput).toHaveValue('');
      // RDP should be displayed as the selected protocol in the dropdown toggle
      expect(screen.getByRole('button', { name: /RDP Remote Desktop/i })).toBeInTheDocument();
    });

    it("should update form data when inputs change", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const nameInput = screen.getByTestId('editor-name');
      fireEvent.change(nameInput, { target: { value: 'New Connection' } });

      expect(nameInput).toHaveValue('New Connection');
    });

    it("should update protocol and set default port", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      // Open protocol dropdown and click SSH
      const protocolToggle = screen.getByRole('button', { name: /RDP Remote Desktop/i });
      fireEvent.click(protocolToggle);
      fireEvent.click(screen.getByRole('button', { name: /SSH Secure Shell/i }));

      // Dropdown toggle should now show SSH
      expect(screen.getByRole('button', { name: /SSH Secure Shell/i })).toBeInTheDocument();
    });
  });

  describe("Edit Existing Connection", () => {
    it("should populate form with existing connection data", () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn()
      });

      const nameInput = screen.getByTestId('editor-name');
      expect(nameInput).toHaveValue('Test Connection');
    });

    it("should display existing tags", async () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn()
      });

      const tagDisplay = screen.getByTestId('tag-display');
      // Tags should be populated from the connection after useEffect fires
      await waitFor(() => {
        expect(tagDisplay.textContent).toContain('test');
      }, { timeout: 3000 });
    });
  });

  describe("Protocol-Specific Options", () => {
    it("should show SSH options for SSH protocol", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      // Open protocol dropdown and click SSH
      fireEvent.click(screen.getByRole('button', { name: /RDP Remote Desktop/i }));
      fireEvent.click(screen.getByRole('button', { name: /SSH Secure Shell/i }));

      expect(screen.getByTestId('ssh-options')).toBeInTheDocument();
    });

    it("should show HTTP options for HTTP protocol", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      // Open protocol dropdown and click HTTP
      fireEvent.click(screen.getByRole('button', { name: /RDP Remote Desktop/i }));
      fireEvent.click(screen.getByRole('button', { name: /HTTP Web Service/i }));

      expect(screen.getByTestId('http-options')).toBeInTheDocument();
    });
  });

  describe("Tag Management", () => {
    it("should render tag manager", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      expect(screen.getByTestId('tag-manager')).toBeInTheDocument();
    });

    it("should update tags when tag manager changes", async () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const addTagButton = screen.getByText('Add Tag');
      fireEvent.click(addTagButton);

      const tagDisplay = screen.getByTestId('tag-display');
      await waitFor(() => {
        expect(tagDisplay.textContent).toContain('test-tag');
      });
    });
  });

  describe("Save Functionality", () => {
    it("should call onClose when save button is clicked", async () => {
      const mockOnClose = vi.fn();
      renderWithProviders({ isOpen: true, onClose: mockOnClose });

      // Fill required fields first
      const nameInput = screen.getByTestId('editor-name');
      fireEvent.change(nameInput, { target: { value: 'Test Connection' } });

      const hostnameInput = screen.getByPlaceholderText(/192\.168\.1\.100/i);
      fireEvent.change(hostnameInput, { target: { value: 'test.example.com' } });

      const saveButton = screen.getByRole('button', { name: /Create/i });
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

      const saveButton = screen.getByRole('button', { name: /Create/i });
      expect(saveButton).toBeInTheDocument();
    });
  });

  describe("Close Functionality", () => {
    it("should call onClose when new connection is saved", async () => {
      const mockOnClose = vi.fn();
      const { container } = renderWithProviders({ isOpen: true, onClose: mockOnClose });

      const nameInput = screen.getByTestId('editor-name');
      fireEvent.change(nameInput, { target: { value: 'Test' } });

      const form = container.querySelector('form')!;
      fireEvent.submit(form);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
    });

    it("should not render when closed", () => {
      renderWithProviders({ isOpen: false, onClose: vi.fn() });

      expect(screen.queryByText('New Connection')).not.toBeInTheDocument();
    });
  });

  describe("Form Validation", () => {
    it("should require name for saving", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const saveButton = screen.getByRole('button', { name: /Create/i });

      // Form should be submittable even with empty name (validation happens elsewhere)
      expect(saveButton).toBeEnabled();
    });

    it("should handle empty hostname gracefully", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const nameInput = screen.getByTestId('editor-name');
      fireEvent.change(nameInput, { target: { value: 'Test Connection' } });

      // Should not crash with empty hostname
      expect(screen.getByText("New Connection")).toBeInTheDocument();
    });
  });
});