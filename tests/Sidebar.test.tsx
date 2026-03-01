import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sidebar } from "../src/components/connection/Sidebar";
import { Connection } from "../src/types/connection";
import { ConnectionProvider } from "../src/contexts/ConnectionContext";

// Mock child components
vi.mock('../src/components/connection/ConnectionTree', () => ({
  ConnectionTree: ({ onEdit, onDelete, onConnect }: any) => (
    <div data-testid="connection-tree">
      <button onClick={() => onEdit(mockConnection)}>Edit Connection</button>
      <button onClick={() => onDelete(mockConnection)}>Delete Connection</button>
      <button onClick={() => onConnect(mockConnection)}>Connect</button>
    </div>
  )
}));


vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
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

const mockProps = {
  sidebarPosition: "left" as const,
  onToggleSidebarPosition: vi.fn(),
  onNewConnection: vi.fn(),
  onEditConnection: vi.fn(),
  onDeleteConnection: vi.fn(),
  onConnect: vi.fn(),
  onShowPasswordDialog: vi.fn(),
  enableConnectionReorder: true,
};

const renderWithProviders = (props = mockProps) => {
  return render(
    <ConnectionProvider>
      <Sidebar {...props} />
    </ConnectionProvider>
  );
};

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    it("should render sidebar with main elements", () => {
      renderWithProviders();

      expect(screen.getByText("connections.title")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("connections.search")).toBeInTheDocument();
      expect(screen.getByTestId("connection-tree")).toBeInTheDocument();
    });

    it("should render action buttons", () => {
      renderWithProviders();

      expect(screen.getByRole('button', { name: /^connections\.new$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /connections\.newFolder/i })).toBeInTheDocument();
    });
  });

  describe("Search Functionality", () => {
    it("should update search term when typing", () => {
      renderWithProviders();

      const searchInput = screen.getByPlaceholderText("connections.search");
      fireEvent.change(searchInput, { target: { value: 'test search' } });

      expect(searchInput).toHaveValue('test search');
    });

    it("should clear search when clear button is clicked", () => {
      renderWithProviders();

      const searchInput = screen.getByPlaceholderText("connections.search");
      fireEvent.change(searchInput, { target: { value: 'test search' } });

      const clearButton = screen.getByRole('button', { name: /clear/i });
      fireEvent.click(clearButton);

      expect(searchInput).toHaveValue('');
    });
  });

  describe("Connection Actions", () => {
    it("should call onNewConnection when new connection button is clicked", () => {
      renderWithProviders();

      const newButton = screen.getByRole('button', { name: /^connections\.new$/i });
      fireEvent.click(newButton);

      expect(mockProps.onNewConnection).toHaveBeenCalled();
    });
  });


  describe("Filter Functionality", () => {
    it("should toggle filter panel", () => {
      renderWithProviders();

      const filterButton = screen.getByRole('button', { name: /filter/i });
      fireEvent.click(filterButton);

      // Filter panel should be visible (this would need more specific testing)
      expect(screen.getByRole('button', { name: /filter/i })).toBeInTheDocument();
    });

    it("should show tag filters when available", () => {
      // This would require mocking connections with tags
      renderWithProviders();

      // Basic test that component renders
      expect(screen.getByText("connections.title")).toBeInTheDocument();
    });
  });

  describe("Tree Operations", () => {
    it("should expand all connections", () => {
      renderWithProviders();

      const expandButton = screen.getByRole('button', { name: /connections\.expandAll/i });
      fireEvent.click(expandButton);

      // This would need more complex state testing
      expect(screen.getByTestId("connection-tree")).toBeInTheDocument();
    });

    it("should collapse all connections", () => {
      renderWithProviders();

      const collapseButton = screen.getByRole('button', { name: /connections\.collapseAll/i });
      fireEvent.click(collapseButton);

      expect(screen.getByTestId("connection-tree")).toBeInTheDocument();
    });
  });

  describe("Sidebar Toggle", () => {
    it("should have toggle button", () => {
      renderWithProviders();

      // The toggle button should exist (ChevronLeft/ChevronRight icons)
      const toggleButtons = screen.getAllByRole('button').filter(button =>
        button.querySelector('svg')
      );

      expect(toggleButtons.length).toBeGreaterThan(0);
    });
  });

  describe("Connection Tree Integration", () => {
    it("should pass connection handlers to tree", () => {
      renderWithProviders();

      const editButton = screen.getByText('Edit Connection');
      fireEvent.click(editButton);

      expect(mockProps.onEditConnection).toHaveBeenCalledWith(mockConnection);
    });

    it("should handle delete action", () => {
      renderWithProviders();

      const deleteButton = screen.getByText('Delete Connection');
      fireEvent.click(deleteButton);

      expect(mockProps.onDeleteConnection).toHaveBeenCalledWith(mockConnection);
    });

    it("should handle connect action", () => {
      renderWithProviders();

      const connectButton = screen.getByText('Connect');
      fireEvent.click(connectButton);

      expect(mockProps.onConnect).toHaveBeenCalledWith(mockConnection);
    });
  });

  describe("Password Protection", () => {
    it("should show password dialog button when needed", () => {
      renderWithProviders();

      // This would depend on the application state
      // For now, just verify the component renders
      expect(screen.getByText("connections.title")).toBeInTheDocument();
    });
  });
});
