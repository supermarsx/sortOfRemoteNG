import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RdpLogViewer } from "../src/components/RdpLogViewer";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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

describe("RdpLogViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValue(mockLogs);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it("uses centralized form classes for filters", async () => {
    render(<RdpLogViewer isVisible />);

    expect(
      await screen.findByText("connected successfully"),
    ).toBeInTheDocument();

    const filterInput = screen.getByPlaceholderText("Filter logs...");
    expect(filterInput.className).toContain("sor-settings-input");

    const selects = screen.getAllByRole("combobox");
    expect(selects[0].className).toContain("sor-settings-select");
  });

  it("filters logs by text and level", async () => {
    render(<RdpLogViewer isVisible />);

    expect(
      await screen.findByText("connected successfully"),
    ).toBeInTheDocument();
    expect(screen.getByText("authentication failure")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Filter logs..."), {
      target: { value: "failure" },
    });

    await waitFor(() => {
      expect(
        screen.queryByText("connected successfully"),
      ).not.toBeInTheDocument();
      expect(screen.getByText("authentication failure")).toBeInTheDocument();
    });

    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "error" },
    });

    await waitFor(() => {
      expect(screen.getByText("authentication failure")).toBeInTheDocument();
    });
  });
});
