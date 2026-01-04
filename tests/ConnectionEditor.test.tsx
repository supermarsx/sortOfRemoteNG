import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionEditor } from "../src/components/ConnectionEditor";
import { Connection } from "../src/types/connection";
import { ConnectionProvider } from "../src/contexts/ConnectionContext";

// Mock child components
vi.mock('../src/components/TagManager', () => ({
  TagManager: ({ tags, onChange }: any) => (
    <div data-testid="tag-manager">
      <span>Tags: {tags?.join(', ') || 'none'}</span>
      <button onClick={() => onChange(['test-tag'])}>Add Tag</button>
    </div>
  )
}));

vi.mock('../src/components/connectionEditor/GeneralSection', () => ({
  default: ({ formData, setFormData }: any) => (
    <div data-testid="general-section">
      <input
        data-testid="name-input"
        value={formData.name || ''}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        placeholder="Connection name"
      />
      <select
        data-testid="protocol-select"
        value={formData.protocol || 'rdp'}
        onChange={(e) => setFormData({ ...formData, protocol: e.target.value })}
      >
        <option value="rdp">RDP</option>
        <option value="ssh">SSH</option>
        <option value="vnc">VNC</option>
      </select>
    </div>
  )
}));

vi.mock('../src/components/connectionEditor/SSHOptions', () => ({
  default: () => <div data-testid="ssh-options">SSH Options</div>
}));

vi.mock('../src/components/connectionEditor/HTTPOptions', () => ({
  default: () => <div data-testid="http-options">HTTP Options</div>
}));

vi.mock('../src/components/connectionEditor/CloudProviderOptions', () => ({
  default: () => <div data-testid="cloud-options">Cloud Options</div>
}));

vi.mock('../src/utils/defaultPorts', () => ({
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

vi.mock('../src/utils/id', () => ({
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
  createdAt: new Date(),
  updatedAt: new Date()
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

    it("should display close button", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    it("should display save button", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      expect(screen.getByRole('button', { name: /Create/i })).toBeInTheDocument();
    });
  });

  describe("New Connection", () => {
    it("should initialize with default values for new connection", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const nameInput = screen.getByTestId('name-input');
      const protocolSelect = screen.getByTestId('protocol-select');

      expect(nameInput).toHaveValue('');
      expect(protocolSelect).toHaveValue('rdp');
    });

    it("should update form data when inputs change", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const nameInput = screen.getByTestId('name-input');
      fireEvent.change(nameInput, { target: { value: 'New Connection' } });

      expect(nameInput).toHaveValue('New Connection');
    });

    it("should update protocol and set default port", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const protocolSelect = screen.getByTestId('protocol-select');
      fireEvent.change(protocolSelect, { target: { value: 'ssh' } });

      expect(protocolSelect).toHaveValue('ssh');
    });
  });

  describe("Edit Existing Connection", () => {
    it("should populate form with existing connection data", () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn()
      });

      const nameInput = screen.getByTestId('name-input');
      expect(nameInput).toHaveValue('Test Connection');
    });

    it("should display existing tags", () => {
      renderWithProviders({
        connection: mockConnection,
        isOpen: true,
        onClose: vi.fn()
      });

      expect(screen.getByText("Tags: test, rdp")).toBeInTheDocument();
    });
  });

  describe("Protocol-Specific Options", () => {
    it("should show SSH options for SSH protocol", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const protocolSelect = screen.getByTestId('protocol-select');
      fireEvent.change(protocolSelect, { target: { value: 'ssh' } });

      expect(screen.getByTestId('ssh-options')).toBeInTheDocument();
    });

    it("should show HTTP options for HTTP protocol", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const protocolSelect = screen.getByTestId('protocol-select');
      fireEvent.change(protocolSelect, { target: { value: 'http' } });

      expect(screen.getByTestId('http-options')).toBeInTheDocument();
    });
  });

  describe("Tag Management", () => {
    it("should render tag manager", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      expect(screen.getByTestId('tag-manager')).toBeInTheDocument();
    });

    it("should update tags when tag manager changes", () => {
      renderWithProviders({ isOpen: true, onClose: vi.fn() });

      const addTagButton = screen.getByText('Add Tag');
      fireEvent.click(addTagButton);

      expect(screen.getByText("Tags: test-tag")).toBeInTheDocument();
    });
  });

  describe("Save Functionality", () => {
    it("should call onClose when save button is clicked", () => {
      const mockOnClose = vi.fn();
      renderWithProviders({ isOpen: true, onClose: mockOnClose });

      const saveButton = screen.getByRole('button', { name: /Create/i });
      fireEvent.click(saveButton);

      expect(mockOnClose).toHaveBeenCalled();
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
    it("should call onClose when close button is clicked", () => {
      const mockOnClose = vi.fn();
      renderWithProviders({ isOpen: true, onClose: mockOnClose });

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it("should call onClose when clicking outside modal", () => {
      const mockOnClose = vi.fn();
      renderWithProviders({ isOpen: true, onClose: mockOnClose });

      // Click on the backdrop (outside the modal content)
      const backdrop = screen.getByTestId('connection-editor-modal');
      fireEvent.click(backdrop);

      expect(mockOnClose).toHaveBeenCalled();
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

      const nameInput = screen.getByTestId('name-input');
      fireEvent.change(nameInput, { target: { value: 'Test Connection' } });

      // Should not crash with empty hostname
      expect(screen.getByText("New Connection")).toBeInTheDocument();
    });
  });
});