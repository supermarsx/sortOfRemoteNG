import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationLogsView } from "../../src/components/monitoring/ApplicationLogsView";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  clipboard: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../src/components/ui/dialogs/ConfirmDialog", () => ({
  ConfirmDialog: ({
    isOpen,
    message,
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Copy log text?">
        <p>{message}</p>
        <button onClick={onConfirm}>Copy log text</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));
const files = [
  {
    id: "latest",
    name: "application.log",
    modifiedUnixMs: 1791558000000,
    sizeBytes: 300,
    encrypted: true,
  },
];
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listen.mockResolvedValue(vi.fn());
  mocks.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.clipboard },
  });
  mocks.invoke.mockImplementation(async (command) =>
    command === "application_logs_list"
      ? { files, truncated: false }
      : { text: "INFO startup\nERROR private address", truncated: false },
  );
});
afterEach(cleanup);

describe("Application logs", () => {
  it("renders native files in an app-themed scrollable view with manual refresh", async () => {
    render(<ApplicationLogsView isActive />);
    expect(
      screen.getByRole("region", { name: "Application logs" }),
    ).toHaveClass("min-h-0", "overflow-hidden", "bg-[var(--color-surface)]");
    expect(
      await screen.findByRole("region", { name: "Log content" }),
    ).toHaveClass("overflow-auto", "min-h-0");
    expect(
      screen.getByRole("checkbox", { name: "Auto-refresh every 10 s" }),
    ).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeEnabled();
    expect(screen.queryByRole("region", { name: "Action Log" })).toBeNull();
    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith("application_logs_read", {
      source: "application",
      id: "latest",
    });
  });

  it("filters lines and requires privacy confirmation before copying only displayed text", async () => {
    render(<ApplicationLogsView isActive />);
    await screen.findByRole("region", { name: "Log content" });
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search log text" }),
      { target: { value: "ERROR" } },
    );
    expect(
      screen.getByRole("region", { name: "Log content" }),
    ).not.toHaveTextContent("INFO startup");
    fireEvent.click(screen.getByRole("button", { name: "Copy displayed log" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "not automatically redacted",
    );
    expect(mocks.clipboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy log text" }));
    await waitFor(() =>
      expect(mocks.clipboard).toHaveBeenCalledWith("ERROR private address"),
    );
  });

  it("clears previous text and copy confirmation on refresh failure, exposing the real error", async () => {
    render(<ApplicationLogsView isActive />);
    await screen.findByRole("region", { name: "Log content" });
    fireEvent.click(screen.getByRole("button", { name: "Copy displayed log" }));
    mocks.invoke.mockRejectedValue("Application storage is locked.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Application storage is locked.",
    );
    expect(screen.queryByRole("region", { name: "Log content" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy displayed log" }),
    ).toBeDisabled();
  });

  it("uses the distinct journal source with truthful scope and bounded output notices", async () => {
    mocks.invoke.mockImplementation(async (command) =>
      command === "application_logs_list"
        ? { files, truncated: true }
        : { text: '{"stage":"ready"}', truncated: true },
    );
    render(<ApplicationLogsView isActive source="browser" />);
    expect(
      screen.getByRole("region", { name: "Browser startup journal" }),
    ).toHaveTextContent("not a website JavaScript console");
    await screen.findByRole("region", { name: "Log content" });
    expect(screen.getByText(/Only the newest log files/)).toBeVisible();
    expect(screen.getByText(/bounded excerpt/)).toBeVisible();
    expect(mocks.invoke).toHaveBeenCalledWith("application_logs_list", {
      source: "browser",
    });
  });

  it("shows an empty state without claiming logs exist", async () => {
    mocks.invoke.mockResolvedValue({ files: [], truncated: false });
    render(<ApplicationLogsView isActive source="browser" />);
    expect(
      await screen.findByText(/No browser startup journal is available yet/),
    ).toBeVisible();
  });

  it("reports clipboard failure and never auto-copies on view change", async () => {
    mocks.clipboard.mockRejectedValue(new Error("denied"));
    const view = render(<ApplicationLogsView isActive />);
    await screen.findByRole("region", { name: "Log content" });
    fireEvent.click(screen.getByRole("button", { name: "Copy displayed log" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy log text" }));
    expect(await screen.findByText(/Could not copy the log/)).toBeVisible();
    view.rerender(<ApplicationLogsView isActive source="browser" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.clipboard).toHaveBeenCalledTimes(1);
  });
});
