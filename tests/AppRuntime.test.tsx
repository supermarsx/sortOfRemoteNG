/**
 * AppRuntime integration tests
 *
 * These tests verify that the full application can mount, render, and operate
 * at runtime.  They exercise the real provider tree (ToastProvider →
 * ConnectionProvider → ErrorBoundary → AppContent) to catch problems that
 * unit tests on individual components would miss.
 */
import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Tauri mocks (hoisted) ────────────────────────────────────────────────

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
  SERIALIZE_TO_IPC_FN: "__TAURI_TO_IPC_KEY__",
  Channel: class {
    id = 0;
    onmessage: ((data: unknown) => void) | null = null;
    constructor(handler?: (data: unknown) => void) {
      if (handler) this.onmessage = handler;
    }
    toJSON() {
      return `__CHANNEL__:${this.id}`;
    }
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => {
  const fns = () => ({
    show: vi.fn(() => Promise.resolve()),
    center: vi.fn(() => Promise.resolve()),
    setFocus: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
    onMoved: vi.fn(() => Promise.resolve(() => {})),
    onResized: vi.fn(() => Promise.resolve(() => {})),
    setAlwaysOnTop: vi.fn(() => Promise.resolve()),
    isAlwaysOnTop: vi.fn(() => Promise.resolve(false)),
    isMaximized: vi.fn(() => Promise.resolve(false)),
    maximize: vi.fn(() => Promise.resolve()),
    unmaximize: vi.fn(() => Promise.resolve()),
    minimize: vi.fn(() => Promise.resolve()),
    setDecorations: vi.fn(() => Promise.resolve()),
    setTitle: vi.fn(() => Promise.resolve()),
    setSize: vi.fn(() => Promise.resolve()),
    setPosition: vi.fn(() => Promise.resolve()),
    innerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
    innerSize: vi.fn(() => Promise.resolve({ width: 1280, height: 720 })),
    outerSize: vi.fn(() => Promise.resolve({ width: 1280, height: 720 })),
    label: "main",
  });

  class _Window {
    label = "main";
    show = vi.fn(() => Promise.resolve());
    center = vi.fn(() => Promise.resolve());
    setFocus = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    isAlwaysOnTop = vi.fn(() => Promise.resolve(false));
    onCloseRequested = vi.fn(() => Promise.resolve(() => {}));
  }

  return {
    getCurrentWindow: vi.fn(() => fns()),
    getAllWindows: vi.fn(() => Promise.resolve([])),
    Window: _Window,
    availableMonitors: vi.fn(() => Promise.resolve([])),
    currentMonitor: vi.fn(() => Promise.resolve(null)),
  };
});

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: class {
    label = "detached";
    constructor() {}
    once = vi.fn(() => Promise.resolve(() => {}));
    listen = vi.fn(() => Promise.resolve(() => {}));
    emit = vi.fn(() => Promise.resolve());
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: vi.fn().mockResolvedValue("/mock/app/data"),
  documentDir: vi.fn().mockResolvedValue("/mock/documents"),
  homeDir: vi.fn().mockResolvedValue("/mock/home"),
  join: vi.fn((...args: string[]) => args.join("/")),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    constructor(public x: number, public y: number) {}
  },
  LogicalSize: class LogicalSize {
    constructor(public width: number, public height: number) {}
  },
}));

// ── react-i18next mock ──────────────────────────────────────────────────
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      typeof fallback === "string" ? fallback : key,
    i18n: {
      language: "en",
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      addResourceBundle: vi.fn(),
    },
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  Trans: ({ children }: any) => <>{children}</>,
}));

// ── rdpCanvas mock ──────────────────────────────────────────────────────
vi.mock("../src/components/rdp/rdpCanvas", () => ({
  drawSimulatedDesktop: vi.fn(),
  drawDesktopIcon: vi.fn(),
  drawWindow: vi.fn(),
  paintFrame: vi.fn(),
  decodeBase64Rgba: vi.fn(() => new Uint8ClampedArray(0)),
  clearCanvas: vi.fn(),
  FrameBuffer: class {
    offscreen = { width: 1920, height: 1080 };
    ctx = {};
    hasPainted = false;
    paintDirect() { this.hasPainted = true; }
    syncFromVisible() {}
    applyRegion() { this.hasPainted = true; }
    resize() {}
    blitTo() {}
    blitFull() {}
  },
}));

// ── i18n loader mock ─────────────────────────────────────────────────────
vi.mock("../src/i18n", () => ({
  default: {
    language: "en",
    changeLanguage: vi.fn(),
    addResourceBundle: vi.fn(),
    t: (key: string) => key,
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
  },
  loadLanguage: vi.fn(),
}));

// ── Import real modules under test ───────────────────────────────────────

import App from "../src/App";
import { ConnectionProvider } from "../src/contexts/ConnectionProvider";
import { ToastProvider, useToastContext } from "../src/contexts/ToastContext";
import { ErrorBoundary } from "../src/components/app/ErrorBoundary";
import { useConnections } from "../src/contexts/useConnections";
import { Connection, ConnectionSession } from "../src/types/connection";
import { generateId } from "../src/utils/id";
import { SplashScreen } from "../src/components/app/SplashScreen";
import {
  isToolProtocol,
  getToolKeyFromProtocol,
  getToolProtocol,
  createToolSession,
  TOOL_LABELS,
} from "../src/components/app/ToolPanel";
import { SettingsManager } from "../src/utils/settingsManager";
import { StatusChecker } from "../src/utils/statusChecker";
import { CollectionManager } from "../src/utils/collectionManager";
import { ThemeManager } from "../src/utils/themeManager";
import { IndexedDbService } from "../src/utils/indexedDbService";
import { PBKDF2_ITERATIONS, DEFAULT_PBKDF2_ITERATIONS } from "../src/config";
import {
  CollectionNotFoundError,
  InvalidPasswordError,
  CorruptedDataError,
} from "../src/utils/errors";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Minimal Connection factory */
const makeConnection = (overrides?: Partial<Connection>): Connection => ({
  id: generateId(),
  name: "Test Server",
  protocol: "ssh",
  hostname: "10.0.0.1",
  port: 22,
  isGroup: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

/** Minimal ConnectionSession factory */
const makeSession = (
  connection: Connection,
  overrides?: Partial<ConnectionSession>,
): ConnectionSession => ({
  id: generateId(),
  connectionId: connection.id,
  name: connection.name,
  status: "connected",
  startTime: new Date(),
  protocol: connection.protocol,
  hostname: connection.hostname,
  reconnectAttempts: 0,
  maxReconnectAttempts: 3,
  ...overrides,
});

/** Helper: render a component that uses useConnections inside ConnectionProvider */
function renderWithProvider(ui: React.ReactElement) {
  return render(<ConnectionProvider>{ui}</ConnectionProvider>);
}

/** Helper component: reads useConnections and renders state info */
function ConnectionStateView() {
  const { state } = useConnections();

  return (
    <div>
      <div data-testid="conn-count">{state.connections.length}</div>
      <div data-testid="sess-count">{state.sessions.length}</div>
      <div data-testid="sidebar-collapsed">
        {state.sidebarCollapsed ? "true" : "false"}
      </div>
      <div data-testid="is-loading">
        {state.isLoading ? "loading" : "idle"}
      </div>
      <div data-testid="filter-search">{state.filter.searchTerm}</div>
      <div data-testid="filter-protocols">
        {state.filter.protocols.join(",")}
      </div>
      <div data-testid="filter-tags">{state.filter.tags.join(",")}</div>
      <div data-testid="selected-name">
        {state.selectedConnection?.name ?? "none"}
      </div>
      <div data-testid="conn-names">
        {state.connections.map((c) => c.name).join(",")}
      </div>
      <div data-testid="sess-names">
        {state.sessions.map((s) => s.name).join(",")}
      </div>
      <div data-testid="sess-statuses">
        {state.sessions.map((s) => s.status).join(",")}
      </div>
    </div>
  );
}

// ── Reset singletons helper ──────────────────────────────────────────────

function resetSingletons() {
  SettingsManager.resetInstance?.();
  StatusChecker.resetInstance?.();
  CollectionManager.resetInstance?.();
  ThemeManager.resetInstance?.();
}

// ── Suites ───────────────────────────────────────────────────────────────

describe("App runtime – full mount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSingletons();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders without crashing", async () => {
    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.querySelector(".app-shell")).toBeTruthy();
    });
  });

  it("shows the splash screen initially", async () => {
    render(<App />);
    await waitFor(() => {
      expect(
        document.querySelector('[class*="fixed"][class*="z-"]') ||
          document.querySelector('[class*="inset-0"]'),
      ).toBeTruthy();
    });
  });

  it("renders the welcome message after initialization", async () => {
    render(<App />);
    await waitFor(
      () => {
        const welcomeArea =
          screen.queryByText(/Welcome to/i) ||
          screen.queryByText(/connections.new/i) ||
          screen.queryByText(/connections.quickConnect/i);
        expect(welcomeArea).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });

  it("has the app-shell div rendered", async () => {
    const { container } = render(<App />);
    await waitFor(() => {
      expect(container.querySelector(".app-shell")).toBeTruthy();
    });
  });

  it("renders App multiple times without side-effect leaks", async () => {
    for (let i = 0; i < 3; i++) {
      resetSingletons();
      const { unmount, container } = render(<App />);
      await waitFor(() => {
        expect(container.querySelector(".app-shell")).toBeTruthy();
      });
      unmount();
    }
  });
});

describe("Provider tree integrity", () => {
  it("ToastProvider renders children", () => {
    render(
      <ToastProvider>
        <div data-testid="child">hello</div>
      </ToastProvider>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("ConnectionProvider renders children and provides context", () => {
    renderWithProvider(<ConnectionStateView />);
    expect(screen.getByTestId("conn-count")).toHaveTextContent("0");
    expect(screen.getByTestId("sess-count")).toHaveTextContent("0");
  });

  it("useConnections throws when used outside provider", () => {
    function BadComponent() {
      useConnections();
      return null;
    }

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<BadComponent />)).toThrow(
      /useConnections must be used within a ConnectionProvider/,
    );
    spy.mockRestore();
  });

  it("ErrorBoundary catches render errors", () => {
    const Bomb = () => {
      throw new Error("Kaboom");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    spy.mockRestore();
  });

  it("nested provider tree (Toast → Connection → ErrorBoundary) renders", () => {
    render(
      <ToastProvider>
        <ConnectionProvider>
          <ErrorBoundary>
            <div data-testid="inner">OK</div>
          </ErrorBoundary>
        </ConnectionProvider>
      </ToastProvider>,
    );
    expect(screen.getByTestId("inner")).toHaveTextContent("OK");
  });

  it("provider tree is stable under re-render", () => {
    let renderCount = 0;
    const Counter = () => {
      renderCount++;
      return <div data-testid="renders">{renderCount}</div>;
    };

    const { rerender } = render(
      <ToastProvider>
        <ConnectionProvider>
          <Counter />
        </ConnectionProvider>
      </ToastProvider>,
    );

    rerender(
      <ToastProvider>
        <ConnectionProvider>
          <Counter />
        </ConnectionProvider>
      </ToastProvider>,
    );

    expect(screen.getByTestId("renders")).toBeInTheDocument();
  });
});

describe("ConnectionProvider state management", () => {
  it("dispatches ADD_CONNECTION and state updates", async () => {
    const conn = makeConnection({ name: "Added Server" });

    function Adder() {
      const { dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "ADD_CONNECTION", payload: conn });
      }, [dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Adder />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("conn-count")).toHaveTextContent("1");
      expect(screen.getByTestId("conn-names")).toHaveTextContent("Added Server");
    });
  });

  it("dispatches UPDATE_CONNECTION", async () => {
    const conn = makeConnection({ name: "Original" });

    function Updater() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          dispatch({ type: "ADD_CONNECTION", payload: conn });
        }
      }, [dispatch]);

      React.useEffect(() => {
        if (step.current === 1 && state.connections.length > 0) {
          step.current = 2;
          dispatch({
            type: "UPDATE_CONNECTION",
            payload: { ...conn, name: "Updated" },
          });
        }
      }, [state.connections, dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Updater />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("conn-names")).toHaveTextContent("Updated");
    });
  });

  it("dispatches DELETE_CONNECTION", async () => {
    const conn = makeConnection();

    function Deleter() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          dispatch({ type: "ADD_CONNECTION", payload: conn });
        }
      }, [dispatch]);

      React.useEffect(() => {
        if (step.current === 1 && state.connections.length > 0) {
          step.current = 2;
          dispatch({ type: "DELETE_CONNECTION", payload: conn.id });
        }
      }, [state.connections, dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Deleter />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("conn-count")).toHaveTextContent("0");
    });
  });

  it("dispatches ADD_SESSION and REMOVE_SESSION", async () => {
    const conn = makeConnection();
    const session = makeSession(conn);

    function SessionManager() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          dispatch({ type: "ADD_SESSION", payload: session });
        }
      }, [dispatch]);

      React.useEffect(() => {
        if (step.current === 1 && state.sessions.length === 1) {
          step.current = 2;
          dispatch({ type: "REMOVE_SESSION", payload: session.id });
        }
      }, [state.sessions, dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <SessionManager />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("sess-count")).toHaveTextContent("0");
    });
  });

  it("dispatches REORDER_SESSIONS", async () => {
    const conn1 = makeConnection({ name: "First" });
    const conn2 = makeConnection({ name: "Second" });
    const session1 = makeSession(conn1);
    const session2 = makeSession(conn2);

    function Reorderer() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          dispatch({ type: "ADD_SESSION", payload: session1 });
          dispatch({ type: "ADD_SESSION", payload: session2 });
        }
      }, [dispatch]);

      React.useEffect(() => {
        if (step.current === 1 && state.sessions.length === 2) {
          step.current = 2;
          dispatch({
            type: "REORDER_SESSIONS",
            payload: { fromIndex: 0, toIndex: 1 },
          });
        }
      }, [state.sessions, dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Reorderer />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("sess-names")).toHaveTextContent("Second,First");
    });
  });

  it("dispatches SELECT_CONNECTION", async () => {
    const conn = makeConnection({ name: "Selected" });

    function Selector() {
      const { dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "ADD_CONNECTION", payload: conn });
        dispatch({ type: "SELECT_CONNECTION", payload: conn });
      }, [dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Selector />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("selected-name")).toHaveTextContent("Selected");
    });
  });

  it("dispatches SET_FILTER", async () => {
    function FilterSetter() {
      const { dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({
          type: "SET_FILTER",
          payload: { searchTerm: "test", protocols: ["ssh"] },
        });
      }, [dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <FilterSetter />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("filter-search")).toHaveTextContent("test");
      expect(screen.getByTestId("filter-protocols")).toHaveTextContent("ssh");
    });
  });

  it("dispatches TOGGLE_SIDEBAR", async () => {
    function Toggler() {
      const { dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "TOGGLE_SIDEBAR" });
      }, [dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Toggler />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("sidebar-collapsed")).toHaveTextContent("true");
    });
  });

  it("dispatches SET_SIDEBAR_COLLAPSED", async () => {
    function Collapser() {
      const { dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "SET_SIDEBAR_COLLAPSED", payload: true });
      }, [dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Collapser />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("sidebar-collapsed")).toHaveTextContent("true");
    });
  });

  it("dispatches SET_LOADING", async () => {
    function Loader() {
      const { dispatch } = useConnections();
      React.useEffect(() => {
        dispatch({ type: "SET_LOADING", payload: true });
      }, [dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Loader />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("is-loading")).toHaveTextContent("loading");
    });
  });

  it("dispatches UPDATE_SESSION", async () => {
    const conn = makeConnection();
    const session = makeSession(conn, { status: "connecting" });

    function SessionUpdater() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          dispatch({ type: "ADD_SESSION", payload: session });
        }
      }, [dispatch]);

      React.useEffect(() => {
        if (step.current === 1 && state.sessions.length === 1) {
          step.current = 2;
          dispatch({
            type: "UPDATE_SESSION",
            payload: { ...session, status: "connected" },
          });
        }
      }, [state.sessions, dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <SessionUpdater />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("sess-statuses")).toHaveTextContent("connected");
    });
  });
});

describe("Toast system runtime", () => {
  it("renders toast messages via context", async () => {
    function Trigger() {
      const { toast } = useToastContext();
      return (
        <button onClick={() => toast.success("Operation successful!")}>
          Fire Toast
        </button>
      );
    }

    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Fire Toast"));

    await waitFor(() => {
      expect(screen.getByText("Operation successful!")).toBeInTheDocument();
    });
  });

  it("renders error toasts", async () => {
    function Trigger() {
      const { toast } = useToastContext();
      return (
        <button onClick={() => toast.error("Something failed!")}>
          Error Toast
        </button>
      );
    }

    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Error Toast"));

    await waitFor(() => {
      expect(screen.getByText("Something failed!")).toBeInTheDocument();
    });
  });

  it("renders warning and info toasts", async () => {
    function Trigger() {
      const { toast } = useToastContext();
      return (
        <div>
          <button onClick={() => toast.warning("Watch out!")}>Warn</button>
          <button onClick={() => toast.info("FYI!")}>Info</button>
        </div>
      );
    }

    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByText("Warn"));
    fireEvent.click(screen.getByText("Info"));

    await waitFor(() => {
      expect(screen.getByText("Watch out!")).toBeInTheDocument();
      expect(screen.getByText("FYI!")).toBeInTheDocument();
    });
  });

  it("useToastContext throws outside provider", () => {
    function BadComponent() {
      useToastContext();
      return null;
    }

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<BadComponent />)).toThrow(
      /useToastContext must be used within a ToastProvider/,
    );
    spy.mockRestore();
  });
});

describe("Utility modules runtime", () => {
  describe("generateId", () => {
    it("returns a non-empty string", () => {
      const id = generateId();
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });

  describe("Custom errors", () => {
    it("CollectionNotFoundError has correct name and message", () => {
      const err = new CollectionNotFoundError("missing");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CollectionNotFoundError");
      expect(err.message).toBe("missing");
    });

    it("CollectionNotFoundError uses default message", () => {
      const err = new CollectionNotFoundError();
      expect(err.message).toBe("Collection not found");
    });

    it("InvalidPasswordError has correct name and message", () => {
      const err = new InvalidPasswordError("bad pw");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("InvalidPasswordError");
      expect(err.message).toBe("bad pw");
    });

    it("InvalidPasswordError uses default message", () => {
      const err = new InvalidPasswordError();
      expect(err.message).toBe("Invalid password");
    });

    it("CorruptedDataError has correct name and message", () => {
      const err = new CorruptedDataError("bad data");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CorruptedDataError");
      expect(err.message).toBe("bad data");
    });

    it("CorruptedDataError uses default message", () => {
      const err = new CorruptedDataError();
      expect(err.message).toBe("Corrupted data");
    });
  });

  describe("config constants", () => {
    it("PBKDF2_ITERATIONS is a positive number", () => {
      expect(typeof PBKDF2_ITERATIONS).toBe("number");
      expect(PBKDF2_ITERATIONS).toBeGreaterThan(0);
    });

    it("DEFAULT_PBKDF2_ITERATIONS equals 150000", () => {
      expect(DEFAULT_PBKDF2_ITERATIONS).toBe(150000);
    });
  });

  describe("SettingsManager singleton", () => {
    beforeEach(() => SettingsManager.resetInstance?.());

    it("getInstance returns the same reference", () => {
      const a = SettingsManager.getInstance();
      const b = SettingsManager.getInstance();
      expect(a).toBe(b);
    });

    it("getSettings returns an object with required defaults", () => {
      const settings = SettingsManager.getInstance().getSettings();
      expect(settings).toBeDefined();
      expect(settings.language).toBe("en");
      expect(settings.theme).toBe("dark");
      expect(settings.colorScheme).toBe("blue");
      expect(typeof settings.autoSaveEnabled).toBe("boolean");
      expect(typeof settings.warnOnClose).toBe("boolean");
    });
  });

  describe("StatusChecker singleton", () => {
    beforeEach(() => StatusChecker.resetInstance?.());

    it("getInstance returns the same reference", () => {
      const a = StatusChecker.getInstance();
      const b = StatusChecker.getInstance();
      expect(a).toBe(b);
    });
  });

  describe("CollectionManager singleton", () => {
    beforeEach(() => CollectionManager.resetInstance?.());

    it("getInstance returns the same reference", () => {
      const a = CollectionManager.getInstance();
      const b = CollectionManager.getInstance();
      expect(a).toBe(b);
    });
  });

  describe("ThemeManager singleton", () => {
    beforeEach(() => ThemeManager.resetInstance?.());

    it("getInstance returns the same reference", () => {
      const a = ThemeManager.getInstance();
      const b = ThemeManager.getInstance();
      expect(a).toBe(b);
    });
  });
});

describe("ToolPanel helpers runtime", () => {
  it("isToolProtocol identifies tool protocols", () => {
    expect(isToolProtocol("tool:performanceMonitor")).toBe(true);
    expect(isToolProtocol("tool:actionLog")).toBe(true);
    expect(isToolProtocol("ssh")).toBe(false);
    expect(isToolProtocol("rdp")).toBe(false);
    expect(isToolProtocol("")).toBe(false);
  });

  it("getToolKeyFromProtocol extracts tool key", () => {
    expect(getToolKeyFromProtocol("tool:performanceMonitor")).toBe("performanceMonitor");
    expect(getToolKeyFromProtocol("tool:actionLog")).toBe("actionLog");
    expect(getToolKeyFromProtocol("ssh")).toBeNull();
  });

  it("getToolProtocol builds protocol string", () => {
    expect(getToolProtocol("performanceMonitor")).toBe("tool:performanceMonitor");
    expect(getToolProtocol("wol")).toBe("tool:wol");
  });

  it("createToolSession returns a valid session object", () => {
    const session = createToolSession("performanceMonitor");
    expect(session).toBeDefined();
    expect(session.protocol).toBe("tool:performanceMonitor");
    expect(session.id).toBeTruthy();
    expect(session.status).toBeDefined();
  });

  it("TOOL_LABELS contains all tool keys", () => {
    const expectedKeys = [
      "performanceMonitor", "actionLog", "shortcutManager", "proxyChain",
      "internalProxy", "wol", "bulkSsh", "scriptManager", "macroManager",
      "recordingManager",
    ];
    for (const key of expectedKeys) {
      expect(TOOL_LABELS[key as keyof typeof TOOL_LABELS]).toBeDefined();
      expect(typeof TOOL_LABELS[key as keyof typeof TOOL_LABELS]).toBe("string");
    }
  });
});

describe("SplashScreen runtime", () => {
  it("renders when isLoading is true", () => {
    const { container } = render(<SplashScreen isLoading={true} />);
    expect(container.querySelector('[class*="fixed"]')).toBeTruthy();
  });

  it("calls onLoadComplete after loading finishes", async () => {
    const onComplete = vi.fn();

    const { rerender } = render(
      <SplashScreen isLoading={true} onLoadComplete={onComplete} />,
    );

    rerender(
      <SplashScreen isLoading={false} onLoadComplete={onComplete} />,
    );

    await waitFor(
      () => {
        expect(onComplete).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
  });
});

describe("Connection type runtime checks", () => {
  it("Connection object satisfies required fields", () => {
    const conn = makeConnection();
    expect(conn.id).toBeTruthy();
    expect(conn.name).toBe("Test Server");
    expect(conn.protocol).toBe("ssh");
    expect(conn.hostname).toBe("10.0.0.1");
    expect(conn.port).toBe(22);
    expect(conn.isGroup).toBe(false);
    expect(conn.createdAt).toBeInstanceOf(Date);
    expect(conn.updatedAt).toBeInstanceOf(Date);
  });

  it("Connection group has isGroup=true", () => {
    const group = makeConnection({
      name: "Servers",
      isGroup: true,
      hostname: "",
      port: 0,
    });
    expect(group.isGroup).toBe(true);
    expect(group.name).toBe("Servers");
  });

  it("ConnectionSession object satisfies required fields", () => {
    const conn = makeConnection();
    const session = makeSession(conn);
    expect(session.id).toBeTruthy();
    expect(session.connectionId).toBe(conn.id);
    expect(session.name).toBe(conn.name);
    expect(session.status).toBe("connected");
    expect(session.protocol).toBe("ssh");
    expect(session.hostname).toBe("10.0.0.1");
    expect(session.startTime).toBeInstanceOf(Date);
  });

  it("supports all defined protocols", () => {
    const protocols = [
      "rdp", "ssh", "vnc", "anydesk", "http", "https", "telnet",
      "rlogin", "mysql", "ftp", "sftp", "scp", "winrm", "rustdesk", "smb",
    ];
    for (const protocol of protocols) {
      const conn = makeConnection({ protocol: protocol as any, port: 1 });
      expect(conn.protocol).toBe(protocol);
    }
  });
});

describe("IndexedDB service runtime", () => {
  it("initializes without errors", async () => {
    await expect(IndexedDbService.init()).resolves.not.toThrow();
  });

  it("setItem and getItem round-trip", async () => {
    await IndexedDbService.init();
    const key = `test-key-${Date.now()}`;
    const value = { hello: "world", num: 42 };
    await IndexedDbService.setItem(key, value);
    const result = await IndexedDbService.getItem(key);
    expect(result).toEqual(value);
    await IndexedDbService.removeItem(key);
  });

  it("getItem returns null for missing key", async () => {
    await IndexedDbService.init();
    const result = await IndexedDbService.getItem("nonexistent-key-xyz");
    expect(result).toBeNull();
  });

  it("removeItem removes a key", async () => {
    await IndexedDbService.init();
    const key = `remove-test-${Date.now()}`;
    await IndexedDbService.setItem(key, "data");
    await IndexedDbService.removeItem(key);
    const result = await IndexedDbService.getItem(key);
    expect(result).toBeNull();
  });
});

describe("Multiple connections workflow", () => {
  it("manages multiple connections simultaneously", async () => {
    const conns = [
      makeConnection({ name: "Server A", protocol: "ssh", port: 22 }),
      makeConnection({ name: "Server B", protocol: "rdp", port: 3389 }),
      makeConnection({ name: "Server C", protocol: "vnc", port: 5900 }),
    ];

    function Adder() {
      const { dispatch } = useConnections();
      const didAdd = React.useRef(false);
      React.useEffect(() => {
        if (!didAdd.current) {
          didAdd.current = true;
          conns.forEach((c) => dispatch({ type: "ADD_CONNECTION", payload: c }));
        }
      }, [dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Adder />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("conn-count")).toHaveTextContent("3");
      expect(screen.getByTestId("conn-names")).toHaveTextContent(
        "Server A,Server B,Server C",
      );
    });
  });

  it("manages connection groups with children", async () => {
    const group = makeConnection({
      name: "Production",
      isGroup: true,
      hostname: "",
      port: 0,
    });
    const child1 = makeConnection({ name: "Web Server", parentId: group.id });
    const child2 = makeConnection({ name: "DB Server", parentId: group.id });

    function Adder() {
      const { dispatch } = useConnections();
      const didAdd = React.useRef(false);
      React.useEffect(() => {
        if (!didAdd.current) {
          didAdd.current = true;
          dispatch({ type: "ADD_CONNECTION", payload: group });
          dispatch({ type: "ADD_CONNECTION", payload: child1 });
          dispatch({ type: "ADD_CONNECTION", payload: child2 });
        }
      }, [dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Adder />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("conn-count")).toHaveTextContent("3");
      expect(screen.getByTestId("conn-names")).toHaveTextContent(
        "Production,Web Server,DB Server",
      );
    });
  });

  it("manages multiple sessions across connections", async () => {
    const conn1 = makeConnection({ name: "Host A" });
    const conn2 = makeConnection({ name: "Host B" });
    const session1 = makeSession(conn1);
    const session2 = makeSession(conn2);

    function Adder() {
      const { dispatch } = useConnections();
      const didAdd = React.useRef(false);
      React.useEffect(() => {
        if (!didAdd.current) {
          didAdd.current = true;
          dispatch({ type: "ADD_SESSION", payload: session1 });
          dispatch({ type: "ADD_SESSION", payload: session2 });
        }
      }, [dispatch]);
      return null;
    }

    renderWithProvider(
      <>
        <Adder />
        <ConnectionStateView />
      </>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("sess-names")).toHaveTextContent("Host A,Host B");
    });
  });
});

describe("ErrorBoundary recovery", () => {
  it("renders children when no error occurs", () => {
    render(
      <ErrorBoundary>
        <div data-testid="safe">All good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByTestId("safe")).toHaveTextContent("All good");
  });

  it("renders fallback when deeply nested child throws", () => {
    const DeepBomb = () => {
      const Inner = () => {
        throw new Error("Deep error");
      };
      return <Inner />;
    };

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <DeepBomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    spy.mockRestore();
  });

  it("does not crash the outer app when inner ErrorBoundary catches", () => {
    const Bomb = () => {
      throw new Error("inner fail");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <div data-testid="outer">
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByTestId("outer")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("Connection filter and selection workflow", () => {
  it("filters connections by search term in state", async () => {
    const conns = [
      makeConnection({ name: "Production Web" }),
      makeConnection({ name: "Staging DB" }),
      makeConnection({ name: "Production API" }),
    ];

    function FilterTest() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          conns.forEach((c) => dispatch({ type: "ADD_CONNECTION", payload: c }));
        }
      }, [dispatch]);

      React.useEffect(() => {
        if (step.current === 1 && state.connections.length === 3) {
          step.current = 2;
          dispatch({ type: "SET_FILTER", payload: { searchTerm: "Production" } });
        }
      }, [dispatch, state.connections]);

      const filtered = state.connections.filter((c) =>
        c.name.toLowerCase().includes(state.filter.searchTerm.toLowerCase()),
      );

      return (
        <div>
          <div data-testid="total">{state.connections.length}</div>
          <div data-testid="filtered">{filtered.length}</div>
          <div data-testid="search">{state.filter.searchTerm}</div>
        </div>
      );
    }

    renderWithProvider(<FilterTest />);

    await waitFor(() => {
      expect(screen.getByTestId("search")).toHaveTextContent("Production");
      expect(screen.getByTestId("total")).toHaveTextContent("3");
      expect(screen.getByTestId("filtered")).toHaveTextContent("2");
    });
  });

  it("filters by protocol", async () => {
    const conns = [
      makeConnection({ name: "SSH1", protocol: "ssh" }),
      makeConnection({ name: "RDP1", protocol: "rdp" }),
      makeConnection({ name: "SSH2", protocol: "ssh" }),
    ];

    function FilterByProtocol() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          conns.forEach((c) => dispatch({ type: "ADD_CONNECTION", payload: c }));
          dispatch({ type: "SET_FILTER", payload: { protocols: ["ssh"] } });
        }
      }, [dispatch]);

      const filtered =
        state.filter.protocols.length > 0
          ? state.connections.filter((c) => state.filter.protocols.includes(c.protocol))
          : state.connections;

      return <div data-testid="filtered">{filtered.length}</div>;
    }

    renderWithProvider(<FilterByProtocol />);

    await waitFor(() => {
      expect(screen.getByTestId("filtered")).toHaveTextContent("2");
    });
  });

  it("filters by tags", async () => {
    const conns = [
      makeConnection({ name: "A", tags: ["prod", "web"] }),
      makeConnection({ name: "B", tags: ["staging"] }),
      makeConnection({ name: "C", tags: ["prod", "db"] }),
    ];

    function FilterByTags() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          conns.forEach((c) => dispatch({ type: "ADD_CONNECTION", payload: c }));
          dispatch({ type: "SET_FILTER", payload: { tags: ["prod"] } });
        }
      }, [dispatch]);

      const filtered =
        state.filter.tags.length > 0
          ? state.connections.filter((c) =>
              state.filter.tags.some((tag) => c.tags?.includes(tag)),
            )
          : state.connections;

      return <div data-testid="filtered">{filtered.length}</div>;
    }

    renderWithProvider(<FilterByTags />);

    await waitFor(() => {
      expect(screen.getByTestId("filtered")).toHaveTextContent("2");
    });
  });

  it("filters favorites", async () => {
    const conns = [
      makeConnection({ name: "Fav", favorite: true }),
      makeConnection({ name: "NotFav", favorite: false }),
    ];

    function FilterFavorites() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          conns.forEach((c) => dispatch({ type: "ADD_CONNECTION", payload: c }));
          dispatch({ type: "SET_FILTER", payload: { showFavorites: true } });
        }
      }, [dispatch]);

      const filtered = state.filter.showFavorites
        ? state.connections.filter((c) => c.favorite)
        : state.connections;

      return <div data-testid="filtered">{filtered.length}</div>;
    }

    renderWithProvider(<FilterFavorites />);

    await waitFor(() => {
      expect(screen.getByTestId("filtered")).toHaveTextContent("1");
    });
  });
});

describe("Session lifecycle simulation", () => {
  it("simulates connect → connected → disconnect lifecycle", async () => {
    const conn = makeConnection();
    const session = makeSession(conn, { status: "connecting" });
    const statusFlow: string[] = [];

    function Lifecycle() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          dispatch({ type: "ADD_SESSION", payload: session });
        }
      }, [dispatch]);

      React.useEffect(() => {
        if (state.sessions.length > 0) {
          statusFlow.push(state.sessions[0].status);
        }
        if (step.current === 1 && state.sessions[0]?.status === "connecting") {
          step.current = 2;
          dispatch({
            type: "UPDATE_SESSION",
            payload: { ...session, status: "connected" },
          });
        } else if (step.current === 2 && state.sessions[0]?.status === "connected") {
          step.current = 3;
          dispatch({ type: "REMOVE_SESSION", payload: session.id });
        }
      }, [state.sessions, dispatch]);

      return <div data-testid="sess-count">{state.sessions.length}</div>;
    }

    renderWithProvider(<Lifecycle />);

    await waitFor(() => {
      expect(screen.getByTestId("sess-count")).toHaveTextContent("0");
    });

    expect(statusFlow).toContain("connecting");
    expect(statusFlow).toContain("connected");
  });

  it("simulates error state on a session", async () => {
    const conn = makeConnection();
    const session = makeSession(conn, { status: "connecting" });

    function ErrorLifecycle() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          dispatch({ type: "ADD_SESSION", payload: session });
        }
      }, [dispatch]);

      React.useEffect(() => {
        if (step.current === 1 && state.sessions.length === 1) {
          step.current = 2;
          dispatch({
            type: "UPDATE_SESSION",
            payload: { ...session, status: "error" },
          });
        }
      }, [state.sessions, dispatch]);

      return (
        <div data-testid="status">{state.sessions[0]?.status ?? "none"}</div>
      );
    }

    renderWithProvider(<ErrorLifecycle />);

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("error");
    });
  });
});

describe("Theme and settings defaults", () => {
  beforeEach(() => resetSingletons());

  it("default settings have valid theme values", () => {
    const settings = SettingsManager.getInstance().getSettings();
    const validThemes = ["dark", "light", "auto", "darkest", "oled", "semilight"];
    expect(validThemes).toContain(settings.theme);
  });

  it("default settings have valid color scheme", () => {
    const settings = SettingsManager.getInstance().getSettings();
    const validSchemes = [
      "red", "rose", "pink", "orange", "amber", "yellow", "lime",
      "green", "emerald", "teal", "cyan", "sky", "blue", "indigo",
      "violet", "purple", "fuchsia", "slate", "grey",
    ];
    expect(validSchemes).toContain(settings.colorScheme);
  });

  it("ThemeManager instantiates without errors", () => {
    const tm = ThemeManager.getInstance();
    expect(tm).toBeDefined();
  });
});

describe("Concurrent operations stress test", () => {
  it("handles rapid dispatch calls without state corruption", async () => {
    const BATCH_SIZE = 50;

    function StressAdder() {
      const { state, dispatch } = useConnections();
      const didAdd = React.useRef(false);

      React.useEffect(() => {
        if (!didAdd.current) {
          didAdd.current = true;
          for (let i = 0; i < BATCH_SIZE; i++) {
            dispatch({
              type: "ADD_CONNECTION",
              payload: makeConnection({ name: `Conn-${i}` }),
            });
          }
        }
      }, [dispatch]);

      return <div data-testid="count">{state.connections.length}</div>;
    }

    renderWithProvider(<StressAdder />);

    await waitFor(() => {
      expect(screen.getByTestId("count")).toHaveTextContent(String(BATCH_SIZE));
    });
  });

  it("handles rapid session add/remove without state corruption", async () => {
    const conn = makeConnection();
    const SESSION_COUNT = 20;
    const sessions = Array.from({ length: SESSION_COUNT }, (_, i) =>
      makeSession(conn, { name: `Session-${i}` }),
    );

    function SessionStress() {
      const { state, dispatch } = useConnections();
      const step = React.useRef(0);

      React.useEffect(() => {
        if (step.current === 0) {
          step.current = 1;
          sessions.forEach((s) => dispatch({ type: "ADD_SESSION", payload: s }));
        }
      }, [dispatch]);

      React.useEffect(() => {
        if (step.current === 1 && state.sessions.length === SESSION_COUNT) {
          step.current = 2;
          sessions.forEach((s) =>
            dispatch({ type: "REMOVE_SESSION", payload: s.id }),
          );
        }
      }, [state.sessions, dispatch]);

      return <div data-testid="sessions">{state.sessions.length}</div>;
    }

    renderWithProvider(<SessionStress />);

    await waitFor(() => {
      expect(screen.getByTestId("sessions")).toHaveTextContent("0");
    });
  });
});

describe("localStorage and sessionStorage runtime", () => {
  it("localStorage is available and functional", () => {
    localStorage.setItem("test-runtime", "value");
    expect(localStorage.getItem("test-runtime")).toBe("value");
    localStorage.removeItem("test-runtime");
    expect(localStorage.getItem("test-runtime")).toBeNull();
  });

  it("sessionStorage is available and functional", () => {
    sessionStorage.setItem("test-runtime", "value");
    expect(sessionStorage.getItem("test-runtime")).toBe("value");
    sessionStorage.removeItem("test-runtime");
    expect(sessionStorage.getItem("test-runtime")).toBeNull();
  });
});

describe("Crypto API runtime", () => {
  it("crypto.randomUUID is available", () => {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      const uuid = globalThis.crypto.randomUUID();
      expect(uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    } else {
      const id = generateId();
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("crypto.subtle is available", () => {
    expect(globalThis.crypto?.subtle).toBeDefined();
  });

  it("crypto.getRandomValues works", () => {
    const arr = new Uint8Array(16);
    globalThis.crypto.getRandomValues(arr);
    expect(arr.some((b) => b !== 0)).toBe(true);
  });
});
