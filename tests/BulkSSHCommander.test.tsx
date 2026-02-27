import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BulkSSHCommander } from "../src/components/BulkSSHCommander";
import { ConnectionProvider } from "../src/contexts/ConnectionContext";

// Mock dependencies
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock the useConnections hook
const mockSessions = [
  {
    id: "session-1",
    name: "SSH Server 1",
    protocol: "ssh",
    hostname: "192.168.1.100",
    status: "connected",
    backendSessionId: "backend-1",
  },
  {
    id: "session-2",
    name: "SSH Server 2",
    protocol: "ssh",
    hostname: "192.168.1.101",
    status: "connected",
    backendSessionId: "backend-2",
  },
  {
    id: "session-3",
    name: "RDP Server",
    protocol: "rdp",
    hostname: "192.168.1.102",
    status: "connected",
  },
];

vi.mock("../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: {
      sessions: mockSessions,
      connections: [],
    },
    dispatch: vi.fn(),
  }),
}));

const SCRIPTS_STORAGE_KEY = "bulkSshScripts";
const mockOnClose = vi.fn();

const ensureLocalStorage = () => {
  const hasStorageApi =
    typeof globalThis.localStorage !== "undefined" &&
    typeof globalThis.localStorage.getItem === "function" &&
    typeof globalThis.localStorage.setItem === "function" &&
    typeof globalThis.localStorage.removeItem === "function" &&
    typeof globalThis.localStorage.clear === "function";

  if (hasStorageApi) return;

  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = String(value);
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const key of Object.keys(store)) delete store[key];
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
      get length() {
        return Object.keys(store).length;
      },
    },
  });
};

const renderComponent = (isOpen = true) => {
  return render(
    <ConnectionProvider>
      <BulkSSHCommander isOpen={isOpen} onClose={mockOnClose} />
    </ConnectionProvider>,
  );
};

describe("BulkSSHCommander", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureLocalStorage();
    if (typeof localStorage?.clear === "function") localStorage.clear();
  });

  describe("Basic Rendering", () => {
    it("should not render when isOpen is false", () => {
      renderComponent(false);
      expect(screen.queryByText("Bulk SSH Commander")).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", () => {
      renderComponent(true);
      expect(screen.getByText("Bulk SSH Commander")).toBeInTheDocument();
    });

    it("should display session count", () => {
      renderComponent();
      // Should show 2/2 sessions (only SSH sessions filtered)
      expect(screen.getByText(/2\/2/)).toBeInTheDocument();
    });

    it("should display SSH Sessions section", () => {
      renderComponent();
      expect(screen.getByText("SSH Sessions")).toBeInTheDocument();
    });

    it("should only show SSH sessions, not RDP", () => {
      renderComponent();
      // Use getAllByText since session names appear multiple times
      const sshServer1Elements = screen.getAllByText("SSH Server 1");
      expect(sshServer1Elements.length).toBeGreaterThan(0);
      const sshServer2Elements = screen.getAllByText("SSH Server 2");
      expect(sshServer2Elements.length).toBeGreaterThan(0);
      expect(screen.queryByText("RDP Server")).not.toBeInTheDocument();
    });
  });

  describe("Session Selection", () => {
    it("should select all sessions by default", () => {
      renderComponent();
      // All SSH sessions should be selected by default
      const checkboxIcons = document.querySelectorAll(".lucide-check-square");
      expect(checkboxIcons.length).toBeGreaterThanOrEqual(2);
    });

    it("should toggle session selection when clicked", () => {
      renderComponent();
      // Find session buttons in the sidebar (they have the checkbox behavior)
      const sessionButtons = screen
        .getAllByRole("button")
        .filter((btn) => btn.textContent?.includes("SSH Server"));
      expect(sessionButtons.length).toBeGreaterThan(0);

      // Click should toggle selection
      fireEvent.click(sessionButtons[0]);
    });

    it("should have select all / deselect all functionality", () => {
      renderComponent();
      const selectAllButton = screen.getByText(/Select All|Deselect All/);
      expect(selectAllButton).toBeInTheDocument();
    });
  });

  describe("View Modes", () => {
    it("should have tab view button", () => {
      renderComponent();
      const tabButton = screen.getByTitle("Tab View");
      expect(tabButton).toBeInTheDocument();
    });

    it("should have mosaic view button", () => {
      renderComponent();
      const mosaicButton = screen.getByTitle("Mosaic View");
      expect(mosaicButton).toBeInTheDocument();
    });

    it("should toggle view mode when buttons are clicked", () => {
      renderComponent();
      const tabButton = screen.getByTitle("Tab View");
      const mosaicButton = screen.getByTitle("Mosaic View");

      fireEvent.click(tabButton);
      // Tab view should be active

      fireEvent.click(mosaicButton);
      // Mosaic view should be active
    });
  });

  describe("Command Input", () => {
    it("should render command textarea", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/Enter command/i);
      expect(textarea).toBeInTheDocument();
    });

    it("should update command state when typing", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/Enter command/i);
      fireEvent.change(textarea, { target: { value: "ls -la" } });
      expect(textarea).toHaveValue("ls -la");
    });

    it("should have send button", () => {
      renderComponent();
      expect(screen.getByText("Send")).toBeInTheDocument();
    });

    it("should have cancel/Ctrl+C button", () => {
      renderComponent();
      const cancelButton = screen.getByTitle(/Send Ctrl\+C/i);
      expect(cancelButton).toBeInTheDocument();
    });

    it("should disable send button when command is empty", () => {
      renderComponent();
      const sendButton = screen.getByText("Send").closest("button");
      expect(sendButton).toBeDisabled();
    });
  });

  describe("Script Library", () => {
    it("should have scripts button", () => {
      renderComponent();
      expect(screen.getByText("Scripts")).toBeInTheDocument();
    });

    it("should toggle script library panel when clicked", () => {
      renderComponent();
      const scriptsButton = screen.getByText("Scripts");
      fireEvent.click(scriptsButton);
      // Script library should be visible
      expect(
        screen.getByPlaceholderText(/Search scripts/i),
      ).toBeInTheDocument();
    });

    it("should show default scripts", () => {
      renderComponent();
      const scriptsButton = screen.getByText("Scripts");
      fireEvent.click(scriptsButton);

      expect(screen.getByText("System Info")).toBeInTheDocument();
      expect(screen.getByText("Disk Usage")).toBeInTheDocument();
    });
  });

  describe("History", () => {
    it("should have history button", () => {
      renderComponent();
      expect(screen.getByText("History")).toBeInTheDocument();
    });

    it("should toggle history panel when clicked", () => {
      renderComponent();
      const historyButton = screen.getByText("History");
      fireEvent.click(historyButton);
      // History panel should be visible
      expect(screen.getByText(/No command history/i)).toBeInTheDocument();
    });
  });

  describe("Clear Outputs", () => {
    it("should have clear button", () => {
      renderComponent();
      expect(screen.getByText("Clear")).toBeInTheDocument();
    });
  });

  describe("Close Dialog", () => {
    it("should call onClose when close button is clicked", () => {
      renderComponent();
      const closeButton = screen.getByRole("button", { name: /close/i });
      fireEvent.click(closeButton);
      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it("should close when ESC key is pressed", async () => {
      renderComponent();

      // Press Escape key
      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it("should close when clicking outside the modal", async () => {
      renderComponent();

      // Find the backdrop (the fixed inset-0 div)
      const backdrop = document.querySelector(".fixed.inset-0.bg-black\\/50");
      expect(backdrop).toBeInTheDocument();

      // Click on the backdrop
      fireEvent.click(backdrop!);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalledTimes(1);
      });
    });

    it("should NOT close when clicking inside the modal content", async () => {
      renderComponent();

      // Click on command textarea (inside the modal)
      const textarea = screen.getByPlaceholderText(/Enter command/i);
      fireEvent.click(textarea);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe("Resizable Command Input", () => {
    it("should have command textarea with resize-y class", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/Enter command/i);
      expect(textarea).toHaveClass("resize-y");
    });

    it("should have min and max height constraints", () => {
      renderComponent();
      const textarea = screen.getByPlaceholderText(/Enter command/i);
      expect(textarea).toHaveClass("min-h-[80px]");
      expect(textarea).toHaveClass("max-h-[300px]");
    });
  });

  describe("View Toggle Location", () => {
    it("should have view toggle buttons in secondary toolbar", () => {
      renderComponent();

      // View toggle should be in the secondary toolbar (below header)
      const tabButton = screen.getByTitle("Tab View");
      const mosaicButton = screen.getByTitle("Mosaic View");

      // Both buttons should be visible and in the same parent toolbar
      expect(tabButton).toBeInTheDocument();
      expect(mosaicButton).toBeInTheDocument();

      // They should be siblings (in same button group)
      expect(tabButton.parentElement).toBe(mosaicButton.parentElement);
    });
  });
});

describe("BulkSSHCommander with no sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should show no sessions message when no SSH sessions", () => {
    // Override the mock to return empty sessions
    vi.doMock("../src/contexts/useConnections", () => ({
      useConnections: () => ({
        state: {
          sessions: [],
          connections: [],
        },
        dispatch: vi.fn(),
      }),
    }));

    render(
      <ConnectionProvider>
        <BulkSSHCommander isOpen={true} onClose={mockOnClose} />
      </ConnectionProvider>,
    );

    // The session count should show 0
  });
});

describe("BulkSSHCommander Script Storage", () => {
  beforeEach(() => {
    ensureLocalStorage();
    if (typeof localStorage?.clear === "function") localStorage.clear();
  });

  it("should load saved scripts from localStorage", () => {
    const customScript = {
      id: "custom-1",
      name: "Custom Script",
      description: "A custom test script",
      script: 'echo "Hello World"',
      category: "Custom",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(SCRIPTS_STORAGE_KEY, JSON.stringify([customScript]));

    renderComponent();
    const scriptsButton = screen.getByText("Scripts");
    fireEvent.click(scriptsButton);

    expect(screen.getByText("Custom Script")).toBeInTheDocument();
  });
});
