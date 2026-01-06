import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ScriptManager } from "../src/components/ScriptManager";

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key
  })
}));

const mockOnClose = vi.fn();

const defaultProps = {
  isOpen: true,
  onClose: mockOnClose,
};

const renderComponent = (props = {}) => {
  return render(
    <ScriptManager {...defaultProps} {...props} />
  );
};

// Storage key used by ScriptManager
const SCRIPTS_STORAGE_KEY = 'managedScripts';

// Default scripts that should exist in the component (matches actual component)
const expectedDefaultScripts = [
  "System Info (Linux)",
  "Disk Usage (Linux)",
  "Memory Usage (Linux)",
  "Network Connections (Linux)",
  "System Info (Windows)",
  "Disk Usage (Windows)",
  "Service Status (Linux)",
  "Service Status (Windows)",
];

describe("ScriptManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Basic Rendering", () => {
    it("should not render when isOpen is false", () => {
      renderComponent({ isOpen: false });
      expect(screen.queryByText("Script Manager")).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", () => {
      renderComponent();
      expect(screen.getByText("Script Manager")).toBeInTheDocument();
    });

    it("should display default scripts", () => {
      renderComponent();
      expectedDefaultScripts.forEach(scriptName => {
        expect(screen.getByText(scriptName)).toBeInTheDocument();
      });
    });

    it("should have close button", () => {
      renderComponent();
      const closeButton = screen.getByRole("button", { name: /close/i });
      expect(closeButton).toBeInTheDocument();
    });

    it("should call onClose when close button clicked", () => {
      renderComponent();
      const closeButton = screen.getByRole("button", { name: /close/i });
      fireEvent.click(closeButton);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("Search and Filtering", () => {
    it("should have search input", () => {
      renderComponent();
      expect(screen.getByPlaceholderText(/Search scripts/i)).toBeInTheDocument();
    });

    it("should filter scripts based on search query", () => {
      renderComponent();
      const searchInput = screen.getByPlaceholderText(/Search scripts/i);
      
      fireEvent.change(searchInput, { target: { value: "disk" } });
      
      expect(screen.getByText("Disk Usage (Linux)")).toBeInTheDocument();
      expect(screen.queryByText("Memory Usage (Linux)")).not.toBeInTheDocument();
    });

    it("should have category filter dropdown", () => {
      renderComponent();
      const comboboxes = screen.getAllByRole("combobox");
      expect(comboboxes.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter by category", () => {
      renderComponent();
      const categorySelect = screen.getAllByRole("combobox")[0];
      
      fireEvent.change(categorySelect, { target: { value: "Network" } });
      
      expect(screen.getByText("Network Connections (Linux)")).toBeInTheDocument();
      expect(screen.queryByText("Disk Usage (Linux)")).not.toBeInTheDocument();
    });
  });

  describe("Script Selection", () => {
    it("should select script when clicked", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      // Selected script should show details - script content contains uname
      expect(screen.getByText(/uname/)).toBeInTheDocument();
    });

    it("should display script details in preview panel", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      // Should show language badge - use getAllByText since it appears multiple places
      const bashElements = screen.getAllByText(/^Bash$/);
      expect(bashElements.length).toBeGreaterThan(0);
    });
  });

  describe("Script Actions - Copy", () => {
    it("should have copy to clipboard button for scripts", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const copyButton = screen.getByTitle("Copy to Clipboard");
      expect(copyButton).toBeInTheDocument();
    });

    it("should copy script content to clipboard when copy button clicked", async () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const copyButton = screen.getByTitle("Copy to Clipboard");
      fireEvent.click(copyButton);
      
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
      });
    });
  });

  describe("Script Actions - Duplicate", () => {
    it("should have duplicate button with CopyPlus icon", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const duplicateButton = screen.getByTitle("Duplicate Script");
      expect(duplicateButton).toBeInTheDocument();
    });

    it("should open editor with script copy when duplicate clicked", async () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const duplicateButton = screen.getByTitle("Duplicate Script");
      fireEvent.click(duplicateButton);
      
      // Should open edit mode with copied name
      await waitFor(() => {
        const nameInput = screen.getByDisplayValue(/System Info \(Linux\) \(Copy\)/);
        expect(nameInput).toBeInTheDocument();
      });
    });

    it("should allow duplicate for default scripts", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const duplicateButton = screen.getByTitle("Duplicate Script");
      expect(duplicateButton).not.toBeDisabled();
    });

    it("should allow duplicate for custom scripts", async () => {
      // First create a custom script
      const customScript = {
        id: 'custom-1',
        name: 'My Custom Script',
        description: 'A test script',
        script: 'echo "test"',
        category: 'Custom',
        language: 'bash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify([customScript]));
      
      renderComponent();
      const scriptItem = screen.getByText("My Custom Script");
      fireEvent.click(scriptItem);
      
      const duplicateButton = screen.getByTitle("Duplicate Script");
      expect(duplicateButton).not.toBeDisabled();
    });
  });

  describe("Script Actions - Delete", () => {
    it("should NOT have delete button for default scripts", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      // Delete button should not exist for default scripts (title="Delete")
      expect(screen.queryByTitle("Delete")).not.toBeInTheDocument();
    });

    it("should have delete button for custom scripts", async () => {
      const customScript = {
        id: 'custom-1',
        name: 'My Custom Script',
        description: 'A test script',
        script: 'echo "test"',
        category: 'Custom',
        language: 'bash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify([customScript]));
      
      renderComponent();
      const scriptItem = screen.getByText("My Custom Script");
      fireEvent.click(scriptItem);
      
      const deleteButton = screen.getByTitle("Delete");
      expect(deleteButton).toBeInTheDocument();
    });

    it("should delete custom script when delete button clicked", async () => {
      const customScript = {
        id: 'custom-1',
        name: 'Script To Delete',
        description: 'Will be deleted',
        script: 'echo "delete me"',
        category: 'Custom',
        language: 'bash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify([customScript]));
      
      renderComponent();
      const scriptItem = screen.getByText("Script To Delete");
      fireEvent.click(scriptItem);
      
      const deleteButton = screen.getByTitle("Delete");
      fireEvent.click(deleteButton);
      
      await waitFor(() => {
        expect(screen.queryByText("Script To Delete")).not.toBeInTheDocument();
      });
    });
  });

  describe("Create New Script", () => {
    it("should have new script button", () => {
      renderComponent();
      const newButton = screen.getByText("New Script");
      expect(newButton).toBeInTheDocument();
    });

    it("should open editor when new script clicked", () => {
      renderComponent();
      const newButton = screen.getByText("New Script");
      fireEvent.click(newButton);
      
      // Editor form should appear - look for the name input placeholder
      expect(screen.getByPlaceholderText(/Enter script name/i)).toBeInTheDocument();
    });

    it("should create new script with provided details", async () => {
      renderComponent();
      const newButton = screen.getByText("New Script");
      fireEvent.click(newButton);
      
      // Fill in form
      const nameInput = screen.getByPlaceholderText(/Enter script name/i);
      fireEvent.change(nameInput, { target: { value: 'New Test Script' } });
      
      const descInput = screen.getByPlaceholderText(/Brief description/i);
      fireEvent.change(descInput, { target: { value: 'Test description' } });
      
      // Enter script content
      const scriptTextarea = screen.getByPlaceholderText(/Enter your script here/i);
      fireEvent.change(scriptTextarea, { target: { value: 'echo "hello"' } });
      
      // Save
      const saveButton = screen.getByRole("button", { name: /^Save$/i });
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(screen.getByText("New Test Script")).toBeInTheDocument();
      });
    });

    it("should disable save when name is empty", () => {
      renderComponent();
      const newButton = screen.getByText("New Script");
      fireEvent.click(newButton);
      
      // Don't fill name, just script
      const scriptTextarea = screen.getByPlaceholderText(/Enter your script here/i);
      fireEvent.change(scriptTextarea, { target: { value: 'echo "test"' } });
      
      // Save button should be disabled
      const saveButton = screen.getByRole("button", { name: /^Save$/i });
      expect(saveButton).toBeDisabled();
    });
  });

  describe("Edit Script", () => {
    it("should have edit button for custom scripts", async () => {
      const customScript = {
        id: 'custom-1',
        name: 'Editable Script',
        description: 'Can be edited',
        script: 'echo "edit me"',
        category: 'Custom',
        language: 'bash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify([customScript]));
      
      renderComponent();
      const scriptItem = screen.getByText("Editable Script");
      fireEvent.click(scriptItem);
      
      const editButton = screen.getByTitle("Edit");
      expect(editButton).toBeInTheDocument();
    });

    it("should NOT have edit button for default scripts", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
    });

    it("should update script when edited and saved", async () => {
      const customScript = {
        id: 'custom-1',
        name: 'Original Name',
        description: 'Original description',
        script: 'echo "original"',
        category: 'Custom',
        language: 'bash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify([customScript]));
      
      renderComponent();
      const scriptItem = screen.getByText("Original Name");
      fireEvent.click(scriptItem);
      
      const editButton = screen.getByTitle("Edit");
      fireEvent.click(editButton);
      
      // Edit the name
      const nameInput = screen.getByDisplayValue("Original Name");
      fireEvent.change(nameInput, { target: { value: 'Updated Name' } });
      
      // Save
      const saveButton = screen.getByRole("button", { name: /^Save$/i });
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(screen.getByText("Updated Name")).toBeInTheDocument();
        expect(screen.queryByText("Original Name")).not.toBeInTheDocument();
      });
    });
  });

  describe("Syntax Highlighting", () => {
    it("should display script with syntax highlighting", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      // The preview should contain the script content
      expect(screen.getByText(/uname/i)).toBeInTheDocument();
    });
  });

  describe("Language Detection", () => {
    it("should show detected language option", async () => {
      renderComponent();
      const newButton = screen.getByText("New Script");
      fireEvent.click(newButton);
      
      // Check for language select in editor
      const languageSelect = screen.getByDisplayValue(/Auto Detect/i);
      expect(languageSelect).toBeInTheDocument();
    });
  });

  describe("LocalStorage Persistence", () => {
    it("should persist custom scripts to localStorage", async () => {
      renderComponent();
      const newButton = screen.getByText("New Script");
      fireEvent.click(newButton);
      
      const nameInput = screen.getByPlaceholderText(/Enter script name/i);
      fireEvent.change(nameInput, { target: { value: 'Persisted Script' } });
      
      const scriptTextarea = screen.getByPlaceholderText(/Enter your script here/i);
      fireEvent.change(scriptTextarea, { target: { value: 'echo "persist"' } });
      
      const saveButton = screen.getByRole("button", { name: /^Save$/i });
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        const stored = localStorage.getItem(SCRIPTS_STORAGE_KEY);
        expect(stored).toBeTruthy();
        const scripts = JSON.parse(stored!);
        expect(scripts).toContainEqual(
          expect.objectContaining({ name: 'Persisted Script' })
        );
      });
    });

    it("should load custom scripts from localStorage on mount", () => {
      const customScript = {
        id: 'stored-1',
        name: 'Stored Script',
        description: 'From localStorage',
        script: 'echo "stored"',
        category: 'Custom',
        language: 'bash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify([customScript]));
      
      renderComponent();
      
      expect(screen.getByText("Stored Script")).toBeInTheDocument();
    });

    it("should remove script from localStorage when deleted", async () => {
      const customScript = {
        id: 'to-delete',
        name: 'Delete Me',
        description: 'Will be deleted',
        script: 'echo "bye"',
        category: 'Custom',
        language: 'bash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify([customScript]));
      
      renderComponent();
      const scriptItem = screen.getByText("Delete Me");
      fireEvent.click(scriptItem);
      
      const deleteButton = screen.getByTitle("Delete");
      fireEvent.click(deleteButton);
      
      await waitFor(() => {
        const stored = localStorage.getItem(SCRIPTS_STORAGE_KEY);
        if (stored) {
          const scripts = JSON.parse(stored);
          expect(scripts).not.toContainEqual(
            expect.objectContaining({ name: 'Delete Me' })
          );
        }
      });
    });
  });

  describe("Categories", () => {
    it("should list available categories in filter", () => {
      renderComponent();
      const categorySelects = screen.getAllByRole("combobox");
      const categorySelect = categorySelects[0]; // First combobox is category filter
      
      // Check options exist - use getAllByText since categories appear elsewhere
      expect(screen.getByText("All Categories")).toBeInTheDocument();
      // Check that there is at least one System option in the select
      const systemOptions = screen.getAllByText("System");
      expect(systemOptions.length).toBeGreaterThan(0);
    });

    it("should allow custom category input when creating script", () => {
      renderComponent();
      const newButton = screen.getByText("New Script");
      fireEvent.click(newButton);
      
      // Category input should exist in the form
      const categoryInput = screen.getByPlaceholderText("Custom");
      expect(categoryInput).toBeInTheDocument();
    });
  });
});
