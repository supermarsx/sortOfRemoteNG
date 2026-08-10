import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BulkSSHCommander } from "../../src/components/ssh/BulkSSHCommander";
import { ConnectionProvider } from "../../src/contexts/ConnectionContext";
import { ToastProvider } from "../../src/contexts/ToastContext";
import {
  getSSHCommandHistoryMemorySnapshot,
  resetSSHCommandHistoryMemoryForTests,
} from "../../src/hooks/ssh/useSSHCommandHistory";
import { invoke } from "@tauri-apps/api/core";
import { bulkScriptsStore } from "../../src/hooks/ssh/bulkScriptLibrary";
import { IndexedDbService } from "../../src/utils/storage/indexedDbService";

// ── Mocks to prevent OOM from transitive dependency graph ──

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

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

vi.mock("../../src/contexts/useConnections", () => ({
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
    <ToastProvider>
      <ConnectionProvider>
        <BulkSSHCommander isOpen={isOpen} onClose={mockOnClose} />
      </ConnectionProvider>
    </ToastProvider>,
  );
};

const invokeCallsFor = (command: string) =>
  vi.mocked(invoke).mock.calls.filter(([candidate]) => candidate === command);

describe("BulkSSHCommander", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockReset();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    ensureLocalStorage();
    if (typeof localStorage?.clear === "function") localStorage.clear();
    resetSSHCommandHistoryMemoryForTests();
  });

  describe("Basic Rendering", () => {
    it("should not render when isOpen is false", () => {
      renderComponent(false);
      expect(screen.queryByText("SSH Sessions")).not.toBeInTheDocument();
    });

    it("should render when isOpen is true", () => {
      renderComponent(true);
      expect(screen.getByText("SSH Sessions")).toBeInTheDocument();
    });

    it("should display session count", () => {
      renderComponent();
      // Should show SSH sessions listed
      const sessions = screen.getAllByText(/SSH Server/);
      expect(sessions.length).toBeGreaterThanOrEqual(2);
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
      // All SSH sessions should be selected by default - check semantically
      const sessionButtons = screen
        .getAllByRole("button")
        .filter((btn) => btn.textContent?.includes("SSH Server"));
      // All sessions should be rendered and selected (we have 2 SSH sessions)
      expect(sessionButtons.length).toBe(2);
      // Verify they have selected state styling
      sessionButtons.forEach((btn) => {
        expect(btn.className).toMatch(/border-accent|border-primary/);
      });
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

  describe("Session Preview", () => {
    it("uses the exact backend session ID and strips terminal control sequences", async () => {
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "get_terminal_buffer") {
          return (
            "\u001b]0;secret window title\u0007" +
            "\u001b[32mroot@host:~$ uptime\u001b[0m\r\n" +
            "up 4 days\u0000\u009b31mvisible\u009b0m"
          );
        }
        return undefined;
      });
      renderComponent();

      fireEvent.click(
        screen.getByRole("button", { name: "Peek SSH Server 1" }),
      );

      await waitFor(() =>
        expect(invoke).toHaveBeenCalledWith("get_terminal_buffer", {
          sessionId: "backend-1",
        }),
      );
      expect(
        await screen.findByText(/root@host:~\$ uptime/),
      ).toBeInTheDocument();
      expect(screen.getByText(/up 4 days/)).toBeInTheDocument();
      const pageText = document.body.textContent ?? "";
      expect(pageText).toContain("visible");
      expect(pageText).not.toContain("secret window title");
      expect(pageText).not.toContain("31mvisible");
      expect(pageText).not.toContain("\u001b");
      expect(pageText).not.toContain("\u0000");
      expect(pageText).not.toContain("\u009b");
      expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(0);

      fireEvent.click(screen.getByText("History"));
      expect(screen.getByText(/No command history yet/i)).toBeInTheDocument();
    });

    it("bounds large terminal snapshots and retains the newest output", async () => {
      const oversized =
        "old terminal output\n".repeat(5_000) +
        "\u001b[32mNEWEST OUTPUT\u001b[0m";
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "get_terminal_buffer") return oversized;
        return undefined;
      });
      renderComponent();

      fireEvent.click(
        screen.getByRole("button", { name: "Peek SSH Server 1" }),
      );

      const newest = await screen.findByText(/NEWEST OUTPUT/);
      const preview = newest.closest("pre");
      expect(preview).not.toBeNull();
      expect(preview).toHaveTextContent("Earlier terminal output omitted");
      expect(
        new TextEncoder().encode(preview?.textContent ?? "").byteLength,
      ).toBeLessThanOrEqual(64 * 1024 + 64);
    });

    it("refreshes a previously peeked terminal snapshot", async () => {
      let peekCount = 0;
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "get_terminal_buffer") {
          peekCount += 1;
          return peekCount === 1 ? "first snapshot" : "refreshed snapshot";
        }
        return undefined;
      });
      renderComponent();

      fireEvent.click(
        screen.getByRole("button", { name: "Peek SSH Server 1" }),
      );
      expect(await screen.findByText("first snapshot")).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Refresh SSH Server 1" }),
      );
      expect(await screen.findByText("refreshed snapshot")).toBeInTheDocument();
      expect(invokeCallsFor("get_terminal_buffer")).toHaveLength(2);
    });

    it("shows an explicit empty-buffer state", async () => {
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "get_terminal_buffer") return "";
        return undefined;
      });
      renderComponent();

      fireEvent.click(
        screen.getByRole("button", { name: "Peek SSH Server 1" }),
      );

      expect(
        await screen.findByText("The terminal buffer was empty when peeked."),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Refresh SSH Server 1" }),
      ).toBeInTheDocument();
    });

    it("shows a retryable terminal-buffer error", async () => {
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "get_terminal_buffer") {
          throw new Error("terminal buffer unavailable");
        }
        return undefined;
      });
      renderComponent();

      fireEvent.click(
        screen.getByRole("button", { name: "Peek SSH Server 1" }),
      );

      expect(
        await screen.findByText("terminal buffer unavailable"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Retry SSH Server 1" }),
      ).toBeInTheDocument();
    });

    it("never changes command recipients when peeking an unselected session", async () => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {},
      });
      vi.mocked(invoke).mockImplementation(async (command) => {
        if (command === "get_terminal_buffer") return "peeked only";
        return undefined;
      });
      renderComponent();

      fireEvent.click(
        screen.getByRole("button", {
          name: "Remove SSH Server 1 from command recipients",
        }),
      );
      const unselectedRecipient = screen.getByRole("button", {
        name: "Add SSH Server 1 to command recipients",
      });
      expect(unselectedRecipient).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(
        screen.getByRole("button", { name: "Peek SSH Server 1" }),
      );
      expect(await screen.findByText("peeked only")).toBeInTheDocument();
      expect(unselectedRecipient).toHaveAttribute("aria-pressed", "false");

      fireEvent.change(screen.getByPlaceholderText(/Enter command/i), {
        target: { value: "hostname" },
      });
      fireEvent.click(screen.getByText("Send"));

      await waitFor(() =>
        expect(invokeCallsFor("send_ssh_input")).toEqual([
          ["send_ssh_input", { sessionId: "backend-2", data: "hostname\n" }],
        ]),
      );
      expect(getSSHCommandHistoryMemorySnapshot()[0].executions).toHaveLength(
        1,
      );
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

    it("records accepted input as dispatched without claiming completion", async () => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {},
      });
      vi.mocked(invoke).mockResolvedValue(undefined);
      renderComponent();

      fireEvent.change(screen.getByPlaceholderText(/Enter command/i), {
        target: { value: "uptime" },
      });
      fireEvent.click(screen.getByText("Send"));

      await waitFor(() => {
        const stored = getSSHCommandHistoryMemorySnapshot();
        expect(stored).toHaveLength(1);
        expect(stored[0].executions).toHaveLength(2);
        expect(
          stored[0].executions.every(
            (execution) =>
              execution.status === "pending" &&
              execution.source === "bulk-dispatch" &&
              execution.evidence === "dispatch-accepted" &&
              !("output" in execution) &&
              !("exitCode" in execution),
          ),
        ).toBe(true);
      });
      expect(localStorage.getItem("sshCommandHistory")).toBeNull();
      expect(
        screen.getAllByText(/did not capture remote completion evidence/i),
      ).toHaveLength(2);
      delete (window as any).__TAURI_INTERNALS__;
    });

    it("records rejected input as dispatch failed rather than cancelled execution", async () => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {},
      });
      vi.mocked(invoke).mockRejectedValue(new Error("transport unavailable"));
      renderComponent();

      fireEvent.change(screen.getByPlaceholderText(/Enter command/i), {
        target: { value: "hostname" },
      });
      fireEvent.click(screen.getByText("Send"));

      await waitFor(() => {
        const stored = getSSHCommandHistoryMemorySnapshot();
        expect(stored[0].executions).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              status: "cancelled",
              evidence: "dispatch-failed",
              errorMessage: "transport unavailable",
            }),
          ]),
        );
      });
      expect(localStorage.getItem("sshCommandHistory")).toBeNull();
      expect(screen.queryByText(/command sent successfully/i)).toBeNull();
      delete (window as any).__TAURI_INTERNALS__;
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

    it("should show default scripts", async () => {
      renderComponent();
      const scriptsButton = screen.getByText("Scripts");
      fireEvent.click(scriptsButton);

      expect(await screen.findByText("System Info")).toBeInTheDocument();
      expect(await screen.findByText("Disk Usage")).toBeInTheDocument();
    });

    it("loads scripts through a focusable, named button", async () => {
      renderComponent();
      fireEvent.click(screen.getByText("Scripts"));

      const loadButton = await screen.findByRole("button", {
        name: "Load System Info",
      });
      loadButton.focus();
      expect(loadButton).toHaveFocus();
      fireEvent.click(loadButton);

      expect(
        (screen.getByPlaceholderText(/Enter command/i) as HTMLTextAreaElement)
          .value,
      ).toContain("uname -a");
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

    it("tracks Bulk Commander history by default and states its exact scope", () => {
      renderComponent();

      const toggle = screen.getByRole("button", {
        name: "Disable Bulk Commander history",
      });
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(toggle).toHaveTextContent("Bulk history on");
      expect(toggle).toHaveAttribute(
        "title",
        expect.stringContaining("Bulk Commander command history only"),
      );
      expect(toggle).toHaveAttribute(
        "title",
        expect.stringContaining("does not disable session recording"),
      );
      expect(toggle).toHaveAttribute(
        "title",
        expect.stringContaining("live backend terminal buffer"),
      );
    });

    it("can dispatch without tracking any new command history", async () => {
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        value: {},
      });
      vi.mocked(invoke).mockResolvedValue(undefined);
      renderComponent();

      fireEvent.click(
        screen.getByRole("button", {
          name: "Disable Bulk Commander history",
        }),
      );
      expect(screen.getByText("Bulk history off")).toBeInTheDocument();

      fireEvent.change(screen.getByPlaceholderText(/Enter command/i), {
        target: { value: "whoami" },
      });
      fireEvent.click(screen.getByText("Send"));

      await waitFor(() =>
        expect(invokeCallsFor("send_ssh_input")).toEqual([
          ["send_ssh_input", { sessionId: "backend-1", data: "whoami\n" }],
          ["send_ssh_input", { sessionId: "backend-2", data: "whoami\n" }],
        ]),
      );
      expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(0);
      expect(localStorage.getItem("sshCommandHistory")).toBeNull();

      fireEvent.click(screen.getByText("History"));
      expect(screen.getByText(/No command history yet/i)).toBeInTheDocument();
      delete (window as any).__TAURI_INTERNALS__;
    });
  });

  describe("Clear Outputs", () => {
    it("clears preview errors and ignores a late in-flight preview", async () => {
      let previewCalls = 0;
      let resolveLatePreview!: (value: string) => void;
      vi.mocked(invoke).mockImplementation((command) => {
        if (command !== "get_terminal_buffer") {
          return Promise.resolve(undefined);
        }
        previewCalls += 1;
        if (previewCalls === 1) {
          return Promise.reject(new Error("stale preview error"));
        }
        return new Promise((resolve) => {
          resolveLatePreview = resolve;
        });
      });
      renderComponent();

      fireEvent.click(
        screen.getByRole("button", { name: "Peek SSH Server 1" }),
      );
      expect(
        await screen.findByText("stale preview error"),
      ).toBeInTheDocument();

      fireEvent.click(
        screen.getByRole("button", { name: "Retry SSH Server 1" }),
      );
      expect(
        (await screen.findAllByText("Loading terminal preview...")).length,
      ).toBeGreaterThan(0);

      fireEvent.click(screen.getByText("Clear"));
      expect(screen.queryByText("stale preview error")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Peek SSH Server 1" }),
      ).toBeInTheDocument();

      await act(async () => {
        resolveLatePreview("late terminal output");
        await Promise.resolve();
      });
      expect(
        screen.queryByText("late terminal output"),
      ).not.toBeInTheDocument();
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

    it("should NOT close when clicking inside the panel content", async () => {
      renderComponent();

      // Click on command textarea (inside the panel)
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
    vi.mocked(invoke).mockReset();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    resetSSHCommandHistoryMemoryForTests();
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
      <ToastProvider>
        <ConnectionProvider>
          <BulkSSHCommander isOpen={true} onClose={mockOnClose} />
        </ConnectionProvider>
      </ToastProvider>,
    );

    // The session count should show 0
  });
});

describe("BulkSSHCommander Script Storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockReset();
    delete (window as typeof window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    ensureLocalStorage();
    if (typeof localStorage?.clear === "function") localStorage.clear();
    resetSSHCommandHistoryMemoryForTests();
  });

  it("should migrate saved scripts from localStorage", async () => {
    // Drain any load queued by a component unmounted in the preceding test,
    // then remove the durable generation so this exercises legacy migration
    // deterministically instead of inheriting suite-order state.
    await bulkScriptsStore.load();
    await IndexedDbService.removeItemStrict(bulkScriptsStore.key);
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

    const migrated = await bulkScriptsStore.load();
    expect(migrated.value?.active).toEqual([
      expect.objectContaining({ id: "custom-1", name: "Custom Script" }),
    ]);
    expect(localStorage.getItem(SCRIPTS_STORAGE_KEY)).toBeNull();

    renderComponent();
    const scriptsButton = screen.getByText("Scripts");
    fireEvent.click(scriptsButton);

    expect(await screen.findByText("Custom Script")).toBeInTheDocument();
  });
});
