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
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify({ customScripts: [customScript], modifiedDefaults: [], deletedDefaultIds: [] }));
      
      renderComponent();
      const scriptItem = screen.getByText("My Custom Script");
      fireEvent.click(scriptItem);
      
      const duplicateButton = screen.getByTitle("Duplicate Script");
      expect(duplicateButton).not.toBeDisabled();
    });
  });

  describe("Script Actions - Delete", () => {
    it("should have delete button for default scripts", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      // Delete button should exist for default scripts
      const deleteButton = screen.getByTitle("Delete");
      expect(deleteButton).toBeInTheDocument();
    });

    it("should delete default script when delete button clicked", async () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const deleteButton = screen.getByTitle("Delete");
      fireEvent.click(deleteButton);
      
      await waitFor(() => {
        expect(screen.queryByText("System Info (Linux)")).not.toBeInTheDocument();
      });
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
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify({ customScripts: [customScript], modifiedDefaults: [], deletedDefaultIds: [] }));
      
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
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify({ customScripts: [customScript], modifiedDefaults: [], deletedDefaultIds: [] }));
      
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
    it("should have edit button for default scripts", () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const editButton = screen.getByTitle("Edit");
      expect(editButton).toBeInTheDocument();
    });

    it("should allow editing default scripts", async () => {
      renderComponent();
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const editButton = screen.getByTitle("Edit");
      fireEvent.click(editButton);
      
      // Should open edit mode
      const nameInput = screen.getByDisplayValue("System Info (Linux)");
      expect(nameInput).toBeInTheDocument();
    });

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
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify({ customScripts: [customScript], modifiedDefaults: [], deletedDefaultIds: [] }));
      
      renderComponent();
      const scriptItem = screen.getByText("Editable Script");
      fireEvent.click(scriptItem);
      
      const editButton = screen.getByTitle("Edit");
      expect(editButton).toBeInTheDocument();
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
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify({ customScripts: [customScript], modifiedDefaults: [], deletedDefaultIds: [] }));
      
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
        const parsed = JSON.parse(stored!);
        // New storage format: { customScripts, modifiedDefaults, deletedDefaultIds }
        expect(parsed.customScripts).toContainEqual(
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

  describe("Modal Close Behavior", () => {
    it("should close when ESC key is pressed", async () => {
      renderComponent();
      
      // Press Escape key
      fireEvent.keyDown(window, { key: 'Escape' });
      
      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it("should close when clicking outside the modal", async () => {
      renderComponent();
      
      // Find the backdrop (the fixed inset-0 div)
      const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/50');
      expect(backdrop).toBeInTheDocument();
      
      // Click on the backdrop
      fireEvent.click(backdrop!);
      
      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it("should NOT close when clicking inside the modal content", async () => {
      renderComponent();
      
      // Click on a script item (inside the modal)
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe("New Storage Format", () => {
    it("should load scripts from new storage format with modifiedDefaults", () => {
      const modifiedDefault = {
        id: 'default-1',
        name: 'Modified System Info (Linux)',
        description: 'Modified description',
        script: 'echo "modified"',
        category: 'System',
        language: 'bash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify({
        customScripts: [],
        modifiedDefaults: [modifiedDefault],
        deletedDefaultIds: []
      }));
      
      renderComponent();
      
      // Should show modified name instead of original
      expect(screen.getByText("Modified System Info (Linux)")).toBeInTheDocument();
      expect(screen.queryByText("System Info (Linux)")).not.toBeInTheDocument();
    });

    it("should not show deleted default scripts", () => {
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify({
        customScripts: [],
        modifiedDefaults: [],
        deletedDefaultIds: ['default-1']
      }));
      
      renderComponent();
      
      // default-1 is System Info (Linux) - should not be shown
      expect(screen.queryByText("System Info (Linux)")).not.toBeInTheDocument();
      // Other default scripts should still be there
      expect(screen.getByText("Disk Usage (Linux)")).toBeInTheDocument();
    });

    it("should persist deleted default script IDs to localStorage", async () => {
      renderComponent();
      
      // Delete a default script
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const deleteButton = screen.getByTitle("Delete");
      fireEvent.click(deleteButton);
      
      await waitFor(() => {
        const stored = localStorage.getItem(SCRIPTS_STORAGE_KEY);
        const parsed = JSON.parse(stored!);
        expect(parsed.deletedDefaultIds).toContain('default-1');
      });
    });

    it("should persist modified default scripts to localStorage", async () => {
      renderComponent();
      
      // Edit a default script
      const scriptItem = screen.getByText("System Info (Linux)");
      fireEvent.click(scriptItem);
      
      const editButton = screen.getByTitle("Edit");
      fireEvent.click(editButton);
      
      const nameInput = screen.getByDisplayValue("System Info (Linux)");
      fireEvent.change(nameInput, { target: { value: 'Custom System Info' } });
      
      const saveButton = screen.getByRole("button", { name: /^Save$/i });
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        const stored = localStorage.getItem(SCRIPTS_STORAGE_KEY);
        const parsed = JSON.parse(stored!);
        const modifiedScript = parsed.modifiedDefaults.find((s: { id: string }) => s.id === 'default-1');
        expect(modifiedScript).toBeTruthy();
        expect(modifiedScript.name).toBe('Custom System Info');
      });
    });

    it("should still load old storage format (array of custom scripts)", () => {
      const oldFormatScript = {
        id: 'old-custom-1',
        name: 'Old Format Script',
        description: 'From old format',
        script: 'echo "old"',
        category: 'Custom',
        language: 'bash',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Old format: just an array
      localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify([oldFormatScript]));
      
      renderComponent();
      
      // Should show both old custom script and all defaults
      expect(screen.getByText("Old Format Script")).toBeInTheDocument();
      expect(screen.getByText("System Info (Linux)")).toBeInTheDocument();
    });
  });
});
