import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionLogEntry } from "../../src/types/settings/settings";
import { ActionLogViewer } from "../../src/components/monitoring/ActionLogViewer";
import {
  actionLogCsvCell,
  actionLogDiagnostics,
  useActionLogViewer,
} from "../../src/hooks/monitoring/useActionLogViewer";
import {
  clearSessionActivityLog,
  getSessionActivityLog,
  recordSessionActivity,
} from "../../src/utils/monitoring/sessionActivityLog";

const fixture = vi.hoisted(() => ({
  logs: [] as ActionLogEntry[],
  listeners: new Set<() => void>(),
  settings: { enableActionLog: true, maxLogEntries: 1000 },
  getActionLog: vi.fn(),
  clipboard: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../../src/utils/settings/settingsManager", () => {
  const manager = {
    getSettings: () => fixture.settings,
    getActionLog: fixture.getActionLog,
    subscribeActionLog(listener: () => void) {
      fixture.listeners.add(listener);
      return () => {
        fixture.listeners.delete(listener);
      };
    },
    clearActionLog() {
      fixture.logs = [];
      fixture.listeners.forEach((listener) => listener());
    },
  };
  return { SettingsManager: { getInstance: () => manager } };
});
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({
    toast: { success: fixture.success, error: fixture.error },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));
const context = {
  sessionId: "session-one",
  connectionId: "connection-one",
  databaseId: "database-one",
};
const legacy = (index = 1): ActionLogEntry => ({
  id: `legacy-${index}`,
  timestamp: new Date(Date.UTC(2026, 8, 14, 12, index)).toISOString(),
  level: "info",
  action: `Legacy action ${index}`,
  connectionName: "legacy-private-name",
  details: `legacy-output-secret-${index}`,
  duration: 0,
});
const changed = () =>
  act(() => fixture.listeners.forEach((listener) => listener()));
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
beforeEach(() => {
  fixture.logs = [legacy()];
  fixture.settings = { enableActionLog: true, maxLogEntries: 1000 };
  fixture.listeners.clear();
  vi.clearAllMocks();
  fixture.getActionLog.mockImplementation(() => fixture.logs);
  fixture.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: fixture.clipboard },
  });
  clearSessionActivityLog();
  URL.createObjectURL = vi.fn(() => "blob:action-log");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  clearSessionActivityLog();
  vi.restoreAllMocks();
  vi.useRealTimers();
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
  if (originalClipboard)
    Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
async function exportedText() {
  const calls = vi.mocked(URL.createObjectURL).mock.calls;
  const blob = calls[calls.length - 1][0] as Blob;
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
}

describe("embedded action log integration", () => {
  it("merges new session events immediately, retains old display text, and filters sources", () => {
    render(<ActionLogViewer isOpen />);
    expect(screen.getByText("legacy-output-secret-1")).toBeVisible();
    act(() =>
      recordSessionActivity(context, "website_script", "completed", {
        durationMs: 42,
      }),
    );
    expect(
      screen.getByText(
        "The action runner completed. Remote application success is not inferred.",
      ),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Filter by source"), {
      target: { value: "website_script" },
    });
    expect(screen.queryByText("legacy-output-secret-1")).toBeNull();
    expect(screen.getAllByTestId("action-log-row")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Filter by source"), {
      target: { value: "application" },
    });
    expect(screen.getByText("legacy-output-secret-1")).toBeVisible();
  });

  it("paginates retained history, sorts across all rows, and resets pages after filtering", () => {
    fixture.logs = Array.from({ length: 61 }, (_, index) => legacy(index));
    render(<ActionLogViewer isOpen />);
    expect(screen.getAllByTestId("action-log-row")).toHaveLength(25);
    fireEvent.click(screen.getByLabelText("Next log page"));
    expect(screen.getByText("Page 2 of 3")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search logs"), {
      target: { value: "secret-60" },
    });
    expect(screen.getByText("Page 1 of 1")).toBeVisible();
    expect(screen.getAllByTestId("action-log-row")).toHaveLength(1);
    fireEvent.click(screen.getByText("Clear filters"));
    fireEvent.click(screen.getByLabelText("Sort logs by timestamp"));
    const table = screen.getByRole("table", { name: "Action log entries" });
    expect(within(table).getAllByTestId("action-log-row")[0]).toHaveTextContent(
      "Legacy action 0",
    );
    expect(
      screen
        .getByRole("button", { name: "Sort logs by timestamp" })
        .closest("th"),
    ).toHaveAttribute("aria-sort", "ascending");
    fireEvent.change(screen.getByLabelText("Log rows per page"), {
      target: { value: "100" },
    });
    expect(screen.getAllByTestId("action-log-row")).toHaveLength(61);
  });

  it("copies metadata-only legacy diagnostics without action/details/name, including zero duration", async () => {
    render(<ActionLogViewer isOpen />);
    await act(async () =>
      fireEvent.click(
        screen.getByLabelText("Copy diagnostics for application entry 1"),
      ),
    );
    const copied = fixture.clipboard.mock.calls[0][0];
    expect(copied).toContain('"action": "Application action"');
    expect(copied).toContain('"durationMs": 0');
    expect(copied).not.toContain("legacy-output-secret");
    expect(copied).not.toContain("legacy-private-name");
    expect(copied).not.toContain("Legacy action 1");
    expect(copied).not.toContain("legacy-1");
    expect(screen.getByRole("status")).toHaveTextContent("Diagnostics copied");
  });

  it("copies all filtered closed session diagnostics, not an unfiltered hidden legacy row", async () => {
    recordSessionActivity(context, "autofill", "waiting_document");
    recordSessionActivity(context, "autofill", "waiting_account_stable");
    render(<ActionLogViewer isOpen />);
    fireEvent.change(screen.getByLabelText("Filter by source"), {
      target: { value: "autofill" },
    });
    await act(async () =>
      fireEvent.click(screen.getByText("Copy filtered diagnostics")),
    );
    const copied = fixture.clipboard.mock.calls[0][0];
    expect(JSON.parse(copied)).toHaveLength(2);
    expect(copied).toContain("session-one");
    expect(copied).not.toContain("legacy-output-secret");
  });

  it("keeps default CSV safe, includes every filtered page, and never silently exports legacy text", async () => {
    fixture.logs = Array.from({ length: 51 }, (_, index) => legacy(index));
    render(<ActionLogViewer isOpen />);
    fireEvent.click(screen.getByText("Export diagnostics CSV"));
    const csv = await exportedText();
    expect(csv.split("\r\n")).toHaveLength(52);
    expect(csv).not.toContain("legacy-output-secret");
    expect(csv).not.toContain("legacy-private-name");
    expect(csv).toContain(
      "Legacy action, details and connection name omitted.",
    );
  });

  it("preserves full application-only CSV behind a sensitive-content confirmation", async () => {
    fixture.logs = [
      {
        ...legacy(),
        action: '=HYPERLINK("private")',
        details: "+SUM(1,1)",
        connectionName: 'name,"quoted"',
      },
    ];
    recordSessionActivity(context, "website_macro", "started");
    render(<ActionLogViewer isOpen />);
    fireEvent.click(screen.getByText("Export application log…"));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByText(/may contain sensitive information/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Export application log",
      }),
    );
    const csv = await exportedText();
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+SUM(1,1)");
    expect(csv).toContain('name,""quoted""');
    expect(csv).not.toContain("Website macro");
  });

  it("clears both stores only after confirmation and labels the configured volatile cap", () => {
    fixture.settings.maxLogEntries = 75;
    recordSessionActivity(context, "ssh_macro", "started");
    render(<ActionLogViewer isOpen />);
    expect(
      screen.getByText(
        /Session activity is retained in this window’s memory, up to 75 entries/,
      ),
    ).toBeVisible();
    fireEvent.click(screen.getByText("Clear", { exact: true }));
    expect(fixture.logs).toHaveLength(1);
    expect(getSessionActivityLog()).toHaveLength(1);
    const confirmation = screen.getByRole("dialog");
    expect(confirmation).toHaveTextContent(
      "saved scripts or macros are not affected",
    );
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Clear" }),
    );
    expect(fixture.logs).toHaveLength(0);
    expect(getSessionActivityLog()).toHaveLength(0);
    expect(screen.getByText("No activity recorded yet")).toBeVisible();
  });

  it("stops subscriptions while inactive and on unmount, without any polling timer", () => {
    vi.useFakeTimers();
    const view = renderHook(({ active }) => useActionLogViewer(active), {
      initialProps: { active: true },
    });
    const reads = fixture.getActionLog.mock.calls.length;
    act(() => vi.advanceTimersByTime(60_000));
    expect(fixture.getActionLog).toHaveBeenCalledTimes(reads);
    expect(fixture.listeners.size).toBe(1);
    view.rerender({ active: false });
    expect(fixture.listeners.size).toBe(0);
    changed();
    act(() => recordSessionActivity(context, "ssh_script", "completed"));
    expect(fixture.getActionLog).toHaveBeenCalledTimes(reads);
    view.rerender({ active: true });
    expect(view.result.current.logs).toHaveLength(2);
    view.unmount();
    const finalReads = fixture.getActionLog.mock.calls.length;
    changed();
    act(() => recordSessionActivity(context, "ssh_script", "failed"));
    expect(fixture.getActionLog).toHaveBeenCalledTimes(finalReads);
    expect(fixture.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("handles denied clipboard access without exposing the underlying error", async () => {
    fixture.clipboard.mockRejectedValueOnce(
      new Error("private-clipboard-error"),
    );
    render(<ActionLogViewer isOpen />);
    await act(async () =>
      fireEvent.click(screen.getByText("Copy filtered diagnostics")),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Could not copy diagnostics",
    );
    expect(document.body).not.toHaveTextContent("private-clipboard-error");
  });

  it.each(["=1+1", "+SUM(1)", "-3", "@cmd", "  =1", "\ttext", "\rtext"])(
    "escapes spreadsheet formula-shaped values: %j",
    (value) => {
      expect(actionLogCsvCell(value)).toBe(`"'${value}"`);
    },
  );

  it("diagnostics omit malformed legacy metadata rather than copying it as free text", () => {
    const view = renderHook(() => useActionLogViewer(true));
    const diagnostic = actionLogDiagnostics({
      ...view.result.current.logs[0],
      timestamp: "private-invalid-timestamp",
      level: "private-level" as "info",
      duration: Number.NaN,
    });
    expect(JSON.stringify(diagnostic)).not.toContain("private");
  });
});
