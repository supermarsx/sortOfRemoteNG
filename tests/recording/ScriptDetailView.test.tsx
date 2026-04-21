import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import ScriptDetailView from "../../src/components/recording/scriptManager/ScriptDetailView";
import { invoke } from "@tauri-apps/api/core";
import type { ManagedScript, ScriptLanguage } from "../../src/components/recording/scriptManager/shared";

// ── Mocks ──────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Mock useConnections to provide session data
const mockSessions: Array<{
  id: string;
  connectionId: string;
  name: string;
  hostname: string;
  protocol: string;
  status: string;
  backendSessionId?: string;
  startTime: Date;
}> = [];

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: mockSessions },
  }),
}));

// Mock HighlightedCode to avoid complex dependencies
vi.mock("../../src/components/ui/display/HighlightedCode", () => ({
  default: ({ code, language }: { code: string; language: string }) => (
    <pre data-testid="highlighted-code" data-language={language}>{code}</pre>
  ),
}));

// ── Helpers ────────────────────────────────────────────────────────

function makeScript(overrides: Partial<ManagedScript> = {}): ManagedScript {
  return {
    id: "test-script-1",
    name: "My Test Script",
    description: "A test script for unit tests",
    script: "#!/bin/bash\necho Hello World\nuptime",
    language: "bash" as ScriptLanguage,
    category: "general",
    osTags: ["linux"],
    createdAt: "2025-06-01T00:00:00Z",
    updatedAt: "2025-06-15T12:00:00Z",
    ...overrides,
  };
}

function makeMgr(script: ManagedScript) {
  return {
    selectedScript: script,
    scripts: [script],
    editingId: null,
    searchFilter: "",
    categoryFilter: "all",
    languageFilter: "all" as string,
    osTagFilter: "all" as string,
    copiedId: null as string | null,
    editName: "",
    editDescription: "",
    editScript: "",
    editLanguage: "bash" as ScriptLanguage,
    editCategory: "general",
    editOsTags: [] as string[],
    categories: ["general"],
    filteredScripts: [script],
    setSearchFilter: vi.fn(),
    setCategoryFilter: vi.fn(),
    setLanguageFilter: vi.fn(),
    setOsTagFilter: vi.fn(),
    setEditName: vi.fn(),
    setEditDescription: vi.fn(),
    setEditScript: vi.fn(),
    setEditLanguage: vi.fn(),
    setEditCategory: vi.fn(),
    handleNewScript: vi.fn(),
    handleEditScript: vi.fn(),
    handleSaveScript: vi.fn(),
    handleDeleteScript: vi.fn(),
    handleCopyScript: vi.fn(),
    handleCancelEdit: vi.fn(),
    handleDuplicateScript: vi.fn(),
    handleSelectScript: vi.fn(),
    toggleOsTag: vi.fn(),
    onClose: vi.fn(),
  };
}

const successResult = {
  stdout: "Hello World\n12:30:00 up 7 days",
  stderr: "",
  exitCode: 0,
  remotePath: "/tmp/.sorng_script_abc",
};

const failedResult = {
  stdout: "",
  stderr: "bash: syntax error",
  exitCode: 1,
  remotePath: "/tmp/.sorng_script_abc",
};

// ── Tests ──────────────────────────────────────────────────────────

describe("ScriptDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessions.length = 0;
    (invoke as Mock).mockResolvedValue(successResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Basic rendering ─────────────────────────────────────────────

  describe("Rendering", () => {
    it("should render script name and description", () => {
      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      expect(screen.getByText("My Test Script")).toBeInTheDocument();
      expect(screen.getByText("A test script for unit tests")).toBeInTheDocument();
    });

    it("should render language badge", () => {
      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      expect(screen.getByText("Bash")).toBeInTheDocument();
    });

    it("should render category", () => {
      const script = makeScript({ category: "networking" });
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      expect(screen.getByText("networking")).toBeInTheDocument();
    });

    it("should render OS tags", () => {
      const script = makeScript({ osTags: ["linux", "macos"] });
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      expect(screen.getByText("Linux")).toBeInTheDocument();
      expect(screen.getByText("macOS")).toBeInTheDocument();
    });

    it("should render script code via HighlightedCode", () => {
      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      const codeEl = screen.getByTestId("highlighted-code");
      expect(codeEl).toHaveTextContent("echo Hello World");
      expect(codeEl).toHaveAttribute("data-language", "bash");
    });

    it("should show Default badge for default scripts", () => {
      const script = makeScript({ id: "default-sysinfo" });
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      expect(screen.getByText("Default")).toBeInTheDocument();
    });

    it("should not show Default badge for custom scripts", () => {
      const script = makeScript({ id: "custom-123" });
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      expect(screen.queryByText("Default")).not.toBeInTheDocument();
    });

    it("should show last updated date", () => {
      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      expect(screen.getByText(/Last updated/)).toBeInTheDocument();
    });
  });

  // ── Action buttons ──────────────────────────────────────────────

  describe("Action Buttons", () => {
    it("should call handleCopyScript when copy button clicked", () => {
      const script = makeScript();
      const mgr = makeMgr(script);
      render(<ScriptDetailView mgr={mgr as any} />);

      const copyBtn = screen.getByTitle("Copy to Clipboard");
      fireEvent.click(copyBtn);

      expect(mgr.handleCopyScript).toHaveBeenCalledWith(script);
    });

    it("should call handleDuplicateScript when duplicate button clicked", () => {
      const script = makeScript();
      const mgr = makeMgr(script);
      render(<ScriptDetailView mgr={mgr as any} />);

      const dupBtn = screen.getByTitle("Duplicate Script");
      fireEvent.click(dupBtn);

      expect(mgr.handleDuplicateScript).toHaveBeenCalledWith(script);
    });

    it("should call handleEditScript when edit button clicked", () => {
      const script = makeScript();
      const mgr = makeMgr(script);
      render(<ScriptDetailView mgr={mgr as any} />);

      const editBtn = screen.getByTitle("Edit");
      fireEvent.click(editBtn);

      expect(mgr.handleEditScript).toHaveBeenCalledWith(script);
    });

    it("should call handleDeleteScript when delete button clicked", () => {
      const script = makeScript();
      const mgr = makeMgr(script);
      render(<ScriptDetailView mgr={mgr as any} />);

      const deleteBtn = screen.getByTitle("Delete");
      fireEvent.click(deleteBtn);

      expect(mgr.handleDeleteScript).toHaveBeenCalledWith("test-script-1");
    });
  });

  // ── Run on SSH ──────────────────────────────────────────────────

  describe("Run on SSH", () => {
    it("should disable run button when no SSH sessions exist", () => {
      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      const runBtn = screen.getByTitle("No active SSH sessions");
      expect(runBtn).toBeDisabled();
    });

    it("should enable run button when an SSH session is active", () => {
      mockSessions.push({
        id: "s1",
        connectionId: "c1",
        name: "Server 1",
        hostname: "server1.example.com",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-1",
        startTime: new Date(),
      });

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      const runBtn = screen.getByTitle("Run on SSH");
      expect(runBtn).not.toBeDisabled();
    });

    it("should run directly when only one session exists (no dropdown)", async () => {
      mockSessions.push({
        id: "s1",
        connectionId: "c1",
        name: "Server 1",
        hostname: "server1.example.com",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-1",
        startTime: new Date(),
      });

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      const runBtn = screen.getByTitle("Run on SSH");
      await act(async () => {
        fireEvent.click(runBtn);
      });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("execute_script", {
          sessionId: "backend-1",
          script: expect.stringContaining("echo Hello World"),
          interpreter: "bash",
        });
      });
    });

    it("should strip shebang lines when running", async () => {
      mockSessions.push({
        id: "s1",
        connectionId: "c1",
        name: "Server 1",
        hostname: "server1.example.com",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-1",
        startTime: new Date(),
      });

      const script = makeScript({ script: "#!/bin/bash\necho hello" });
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      await act(async () => {
        fireEvent.click(screen.getByTitle("Run on SSH"));
      });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("execute_script", {
          sessionId: "backend-1",
          script: "echo hello",
          interpreter: "bash",
        });
      });
    });

    it("should show session dropdown when multiple sessions exist", () => {
      mockSessions.push(
        {
          id: "s1",
          connectionId: "c1",
          name: "Server 1",
          hostname: "server1.example.com",
          protocol: "ssh",
          status: "connected",
          backendSessionId: "backend-1",
          startTime: new Date(),
        },
        {
          id: "s2",
          connectionId: "c2",
          name: "Server 2",
          hostname: "server2.example.com",
          protocol: "ssh",
          status: "connected",
          backendSessionId: "backend-2",
          startTime: new Date(),
        },
      );

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      const runBtn = screen.getByTitle("Run on SSH");
      fireEvent.click(runBtn);

      expect(screen.getByText("Run on session")).toBeInTheDocument();
      expect(screen.getByText("Server 1")).toBeInTheDocument();
      expect(screen.getByText("Server 2")).toBeInTheDocument();
    });

    it("should execute on selected session from dropdown", async () => {
      mockSessions.push(
        {
          id: "s1",
          connectionId: "c1",
          name: "Server 1",
          hostname: "server1.example.com",
          protocol: "ssh",
          status: "connected",
          backendSessionId: "backend-1",
          startTime: new Date(),
        },
        {
          id: "s2",
          connectionId: "c2",
          name: "Server 2",
          hostname: "server2.example.com",
          protocol: "ssh",
          status: "connected",
          backendSessionId: "backend-2",
          startTime: new Date(),
        },
      );

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      fireEvent.click(screen.getByTitle("Run on SSH"));
      await act(async () => {
        fireEvent.click(screen.getByText("Server 2"));
      });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("execute_script", {
          sessionId: "backend-2",
          script: expect.any(String),
          interpreter: "bash",
        });
      });
    });

    it("should ignore non-SSH and non-connected sessions", () => {
      mockSessions.push(
        {
          id: "s1",
          connectionId: "c1",
          name: "RDP Server",
          hostname: "rdp.example.com",
          protocol: "rdp",
          status: "connected",
          startTime: new Date(),
        },
        {
          id: "s2",
          connectionId: "c2",
          name: "Disconnected SSH",
          hostname: "dead.example.com",
          protocol: "ssh",
          status: "disconnected",
          backendSessionId: "dead-1",
          startTime: new Date(),
        },
        {
          id: "s3",
          connectionId: "c3",
          name: "SSH no backend",
          hostname: "nobackend.example.com",
          protocol: "ssh",
          status: "connected",
          startTime: new Date(),
          // no backendSessionId
        },
      );

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      // Should be disabled since no valid SSH sessions
      const runBtn = screen.getByTitle("No active SSH sessions");
      expect(runBtn).toBeDisabled();
    });
  });

  // ── Result display ──────────────────────────────────────────────

  describe("Execution Result Display", () => {
    function setupSingleSession() {
      mockSessions.push({
        id: "s1",
        connectionId: "c1",
        name: "Server 1",
        hostname: "server1.example.com",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-1",
        startTime: new Date(),
      });
    }

    it("should show success result with stdout", async () => {
      setupSingleSession();

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      await act(async () => {
        fireEvent.click(screen.getByTitle("Run on SSH"));
      });

      await waitFor(() => {
        expect(screen.getByText("Execution Output")).toBeInTheDocument();
      });

      expect(screen.getByText("exit 0")).toBeInTheDocument();
      // The stdout appears in the result <pre> — match the full output to avoid matching the script preview
      expect(screen.getByText(/12:30:00 up 7 days/)).toBeInTheDocument();
    });

    it("should show (no output) when stdout is empty", async () => {
      setupSingleSession();
      (invoke as Mock).mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
        remotePath: "/tmp/.sorng_script_x",
      });

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      await act(async () => {
        fireEvent.click(screen.getByTitle("Run on SSH"));
      });

      await waitFor(() => {
        expect(screen.getByText("(no output)")).toBeInTheDocument();
      });
    });

    it("should show stderr when script has errors", async () => {
      setupSingleSession();
      (invoke as Mock).mockResolvedValueOnce(failedResult);

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      await act(async () => {
        fireEvent.click(screen.getByTitle("Run on SSH"));
      });

      await waitFor(() => {
        expect(screen.getByText("exit 1")).toBeInTheDocument();
        expect(screen.getByText("stderr:")).toBeInTheDocument();
        expect(screen.getByText("bash: syntax error")).toBeInTheDocument();
      });
    });

    it("should show failure state when invoke rejects", async () => {
      setupSingleSession();
      (invoke as Mock).mockRejectedValueOnce("Connection refused");

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      await act(async () => {
        fireEvent.click(screen.getByTitle("Run on SSH"));
      });

      await waitFor(() => {
        expect(screen.getByText("Execution Failed")).toBeInTheDocument();
        expect(screen.getByText("Connection refused")).toBeInTheDocument();
      });
    });

    it("should dismiss result panel when Dismiss is clicked", async () => {
      setupSingleSession();

      const script = makeScript();
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);

      await act(async () => {
        fireEvent.click(screen.getByTitle("Run on SSH"));
      });

      await waitFor(() => {
        expect(screen.getByText("Execution Output")).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText("Dismiss"));

      expect(screen.queryByText("Execution Output")).not.toBeInTheDocument();
    });
  });

  // ── Language-to-interpreter in component ────────────────────────

  describe("Language interpreter mapping in component", () => {
    function setupAndRun(language: ScriptLanguage) {
      mockSessions.push({
        id: "s1",
        connectionId: "c1",
        name: "Server",
        hostname: "s.com",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "b1",
        startTime: new Date(),
      });

      const script = makeScript({ language, script: "command" });
      render(<ScriptDetailView mgr={makeMgr(script) as any} />);
      return screen.getByTitle("Run on SSH");
    }

    it("should use 'sh' for sh language", async () => {
      const btn = setupAndRun("sh" as ScriptLanguage);

      await act(async () => { fireEvent.click(btn); });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("execute_script", expect.objectContaining({
          interpreter: "sh",
        }));
      });
    });

    it("should use 'powershell' for powershell language", async () => {
      const btn = setupAndRun("powershell" as ScriptLanguage);

      await act(async () => { fireEvent.click(btn); });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("execute_script", expect.objectContaining({
          interpreter: "powershell",
        }));
      });
    });

    it("should default to 'bash' for bash language", async () => {
      const btn = setupAndRun("bash");

      await act(async () => { fireEvent.click(btn); });

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith("execute_script", expect.objectContaining({
          interpreter: "bash",
        }));
      });
    });
  });
});
