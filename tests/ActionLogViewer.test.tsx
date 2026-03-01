import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { ActionLogViewer } from "../src/components/monitoring/ActionLogViewer";

const mocks = vi.hoisted(() => ({
  getActionLog: vi.fn(),
  clearActionLog: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../src/utils/settingsManager", () => ({
  SettingsManager: {
    getInstance: () => ({
      getActionLog: mocks.getActionLog,
      clearActionLog: mocks.clearActionLog,
      logAction: vi.fn(),
    }),
  },
}));

vi.mock("../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: {
      success: mocks.toastSuccess,
      error: mocks.toastError,
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("ActionLogViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.getActionLog.mockReturnValue([
      {
        id: "1",
        timestamp: new Date("2026-01-01T12:00:00.000Z"),
        level: "info",
        action: "connect",
        connectionName: "prod-1",
        details: "Connected successfully",
        duration: 120,
      },
      {
        id: "2",
        timestamp: new Date("2026-01-01T12:01:00.000Z"),
        level: "error",
        action: "auth",
        connectionName: "prod-2",
        details: "Authentication failed",
        duration: 300,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders logs and supports text filtering", async () => {
    render(<ActionLogViewer isOpen onClose={() => {}} />);

    expect(await screen.findByText("logs.title")).toBeInTheDocument();
    expect(screen.getByText("Connected successfully")).toBeInTheDocument();
    expect(screen.getByText("Authentication failed")).toBeInTheDocument();

    const search = screen.getByPlaceholderText("Search logs...");
    fireEvent.change(search, { target: { value: "prod-1" } });

    await waitFor(() => {
      expect(screen.getByText("Connected successfully")).toBeInTheDocument();
      expect(
        screen.queryByText("Authentication failed"),
      ).not.toBeInTheDocument();
    });
  });

  it("exports filtered logs", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const realCreateElement = document.createElement.bind(document);
    const createElementSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tagName: string) => {
        if (tagName.toLowerCase() === "a") {
          const anchor = realCreateElement("a");
          anchor.click = vi.fn();
          return anchor;
        }
        return realCreateElement(tagName);
      });
    URL.createObjectURL = vi.fn(() => "blob:test-url");
    URL.revokeObjectURL = vi.fn();

    render(<ActionLogViewer isOpen onClose={() => {}} />);
    fireEvent.click(await screen.findByText("logs.export"));

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalled();

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    createElementSpy.mockRestore();
  });

  it("clears logs after confirmation", async () => {
    render(<ActionLogViewer isOpen onClose={() => {}} />);

    fireEvent.click(await screen.findByText("logs.clear"));
    const clearButtons = await screen.findAllByText("logs.clear");
    fireEvent.click(clearButtons[clearButtons.length - 1]);

    expect(mocks.clearActionLog).toHaveBeenCalled();
  });

  it("closes on backdrop and Escape", async () => {
    const onClose = vi.fn();
    const { container } = render(<ActionLogViewer isOpen onClose={onClose} />);

    await screen.findByText("logs.title");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    const backdrop = container.querySelector(".sor-modal-backdrop");
    expect(backdrop).toBeTruthy();
    if (backdrop) fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
