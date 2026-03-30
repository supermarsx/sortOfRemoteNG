import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DetachedClient from "../../app/detached/DetachedClient";

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => (key === "sessionId" ? "s1" : null),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../../src/i18n", () => ({
  default: {},
}));

vi.mock("../../src/components/session/SessionViewer", () => ({
  SessionViewer: () => <div data-testid="mock-session-viewer">Session Viewer</div>,
}));

vi.mock("../../src/hooks/window/useTooltipSystem", () => ({
  useTooltipSystem: vi.fn(),
}));

const mockWindow = {
  label: "detached-1",
  setTitle: vi.fn(() => Promise.resolve()),
  outerPosition: vi.fn(() => Promise.resolve({ x: 0, y: 0 })),
  close: vi.fn(() => Promise.resolve()),
  isAlwaysOnTop: vi.fn(() => Promise.resolve(false)),
  setAlwaysOnTop: vi.fn(() => Promise.resolve()),
  minimize: vi.fn(() => Promise.resolve()),
  isMaximized: vi.fn(() => Promise.resolve(false)),
  maximize: vi.fn(() => Promise.resolve()),
  unmaximize: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
};

const syncedSession = {
  id: "s1",
  connectionId: "c1",
  name: "Session One",
  status: "connected",
  startTime: "2026-01-01T00:00:00.000Z",
  protocol: "ssh",
  hostname: "host-1",
};

const syncedConnection = {
  id: "c1",
  name: "Connection One",
  protocol: "ssh",
  hostname: "host-1",
  port: 22,
  isGroup: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => mockWindow),
  getAllWindows: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn((eventName: string, handler: (event: { payload: unknown }) => void) => {
    if (eventName === "wm:sync") {
      queueMicrotask(() => {
        handler({
          payload: {
            windowId: "detached-1",
            sessions: [syncedSession],
            connections: [syncedConnection],
            tabGroups: [],
            activeSessionId: "s1",
          },
        });
      });
    }
    return Promise.resolve(() => {});
  }),
}));

describe("DetachedClient accessibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  const renderAndLoadDetachedClient = async () => {
    render(<DetachedClient />);

    await waitFor(() => {
      expect(screen.getByRole("tablist", { name: /detached session tabs/i })).toBeInTheDocument();
    });
  };

  it("exposes detached tablist/tab semantics and header control labels", async () => {
    await renderAndLoadDetachedClient();

    const tab = screen.getByRole("tab", { name: /session one/i });
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveAttribute("aria-controls", "detached-session-panel-s1");

    expect(screen.getByLabelText(/rename window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/pin window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/minimize window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/toggle maximize window/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/close window/i)).toBeInTheDocument();
  });

  it("adds labels for window title and tab rename inline inputs", async () => {
    await renderAndLoadDetachedClient();

    fireEvent.click(screen.getByLabelText(/rename window/i));
    expect(await screen.findByLabelText(/edit window title/i)).toBeInTheDocument();

    const tab = screen.getByRole("tab", { name: /session one/i });
    fireEvent.contextMenu(tab);

    fireEvent.click(await screen.findByRole("menuitem", { name: /rename tab/i }));

    expect(await screen.findByLabelText(/rename tab session one/i)).toBeInTheDocument();
  });
});
