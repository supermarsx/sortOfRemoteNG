import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RDPLogViewer } from "../../src/components/rdp/RDPLogViewer";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue([]),
  transformCallback: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(async () => {})),
}));

const mockLogs = [
  {
    timestamp: Date.now(),
    session_id: "session-a-123",
    level: "info",
    message: "connected successfully",
  },
  {
    timestamp: Date.now() + 1000,
    session_id: "session-b-999",
    level: "error",
    message: "authentication failure",
  },
];

describe("RDPLogViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(mockLogs);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("uses centralized form classes for filters", async () => {
    render(<RDPLogViewer isVisible />);

    await screen.findAllByText("connected successfully");

    const filterInput = screen.getByPlaceholderText("Search logs...");
    expect(filterInput.className).toContain("sor-form-input");

    const selects = screen.getAllByRole("combobox");
    expect(selects[0].className).toContain("sor-form-select-sm");
  });

  it("filters logs by text and level", async () => {
    render(<RDPLogViewer isVisible />);

    await screen.findAllByText("connected successfully");
    expect(
      screen.getAllByText("authentication failure")[0],
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search logs..."), {
      target: { value: "failure" },
    });

    await waitFor(() => {
      expect(screen.queryAllByText("connected successfully")).toHaveLength(0);
      expect(
        screen.getAllByText("authentication failure")[0],
      ).toBeInTheDocument();
    });

    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "error" },
    });

    await waitFor(() => {
      expect(
        screen.getAllByText("authentication failure")[0],
      ).toBeInTheDocument();
    });
  });

  it("renders action-log style rows with level classes", async () => {
    render(<RDPLogViewer isVisible />);
    await screen.findAllByText("connected successfully");
    expect(screen.getAllByTestId("rdp-log-row")).toHaveLength(2);
    expect(screen.getByText("info", { selector: "span" }).className).toContain(
      "text-primary",
    );
    expect(screen.getByText("error", { selector: "span" }).className).toContain(
      "text-error",
    );
  });

  it("filters by level and shows the shared empty state", async () => {
    render(<RDPLogViewer isVisible />);
    await screen.findAllByText("connected successfully");
    fireEvent.change(screen.getByLabelText("Filter by level"), {
      target: { value: "error" },
    });
    await waitFor(() =>
      expect(screen.queryAllByText("connected successfully")).toHaveLength(0),
    );
    fireEvent.change(screen.getByLabelText("Search logs"), {
      target: { value: "nomatch" },
    });
    expect(await screen.findByText("No matching log entries")).toBeVisible();
  });
});
