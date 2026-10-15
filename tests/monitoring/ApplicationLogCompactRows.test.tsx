import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationLogTimelineView } from "../../src/components/monitoring/ApplicationLogTimelineView";

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
    onConfirm,
    onCancel,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label="Copy log text?">
        <button onClick={onConfirm}>Copy log text</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));
const archiveName = "application-2026-10-15-archived-session.log.enc";
const message =
  `Archived SSH deployment completed with diagnostic metadata ${"long message segment ".repeat(20)}`.trim();
const continuation =
  "  hidden-search-marker: first diagnostic line\n  second diagnostic line with complete metadata";
const archiveText = `[2026-10-15T12:00:00Z][WARN][sorng_ssh] ${message}\n${continuation}`;
const file = {
  id: "latest",
  name: "application.log",
  modifiedUnixMs: 1792065600000,
  sizeBytes: 2000,
  encrypted: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.listen.mockResolvedValue(vi.fn());
  mocks.clipboard.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.clipboard },
  });
  mocks.invoke.mockImplementation(async (command, args) =>
    command === "application_logs_list"
      ? {
          files:
            args.source === "browser"
              ? []
              : [
                  file,
                  {
                    ...file,
                    id: "archive",
                    name: archiveName,
                    modifiedUnixMs: file.modifiedUnixMs - 1000,
                  },
                ],
          truncated: false,
        }
      : {
          text:
            args.id === "archive"
              ? archiveText
              : "[2026-10-15T12:01:00Z][INFO][sorng_ssh] Current connection ready",
          truncated: false,
        },
  );
});
afterEach(cleanup);
async function showArchive() {
  render(<ApplicationLogTimelineView isActive />);
  await screen.findByRole("region", { name: "Log content" });
  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Log file" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("combobox", { name: "Log file" }));
  fireEvent.mouseDown(
    screen.getByRole("option", {
      name: /Application · application-2026-10-15-archived-session/,
    }),
  );
  const region = await screen.findByRole("region", { name: "Log content" });
  await waitFor(() => expect(region).toHaveTextContent(message));
  return region;
}

describe("compact application log rows", () => {
  it("renders one collapsed summary with truncated message and expands all selectable details and archive provenance", async () => {
    const region = await showArchive();
    const rows = region.querySelectorAll("li");
    expect(rows).toHaveLength(1);
    const details = rows[0].querySelector("details")!;
    const summary = details.querySelector("summary")!;
    expect(details.open).toBe(false);
    expect(summary).toHaveClass("whitespace-nowrap", "min-w-0");
    expect(summary).toHaveTextContent("Application network");
    expect(summary).toHaveTextContent("WARN");
    expect(summary).not.toHaveTextContent("Recorded order");
    expect(summary).not.toHaveTextContent("hidden-search-marker");
    expect(summary).not.toHaveTextContent(archiveName);
    const preview = within(summary).getByText(message);
    expect(preview).toHaveClass("truncate", "min-w-0");
    expect(preview).toHaveAttribute("title", message);
    const body = details.querySelector("div")!;
    expect(body).not.toBeVisible();
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(body).toBeVisible();
    expect(within(body).getByText(message)).toHaveClass(
      "select-text",
      "whitespace-pre-wrap",
    );
    expect(body.textContent).toContain(message);
    expect(body.textContent).toContain(continuation);
    expect(body).toHaveTextContent(`Application file · ${archiveName}`);
    fireEvent.click(summary);
    expect(details.open).toBe(false);
  });
  it("keeps untimed ordering and complete category metadata available in expanded details", async () => {
    const native = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (command, args) => {
      const value = await native(command, args);
      return command === "application_logs_read" && args.id === "archive"
        ? {
            ...value,
            text: "WARN Untimed fixture message\n  untimed diagnostic continuation",
          }
        : value;
    });
    render(<ApplicationLogTimelineView isActive />);
    await screen.findByRole("region", { name: "Log content" });
    fireEvent.click(screen.getByRole("combobox", { name: "Log file" }));
    fireEvent.mouseDown(
      screen.getByRole("option", {
        name: /Application · application-2026-10-15-archived-session/,
      }),
    );
    const region = await screen.findByRole("region", { name: "Log content" });
    await waitFor(() =>
      expect(region).toHaveTextContent("Untimed fixture message"),
    );
    const summary = region.querySelector("summary")!;
    expect(summary).toHaveTextContent("Recorded order 1");
    fireEvent.click(summary);
    const body = region.querySelector("details > div")!;
    expect(body).toBeVisible();
    expect(body).toHaveTextContent("Recorded order 1 (no wall timestamp)");
    expect(body).toHaveTextContent("Application · WARN");
    expect(body).toHaveTextContent(archiveName);
  });
  it("searches hidden details and copies full matching records including provenance after confirmation", async () => {
    const region = await showArchive();
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search log text" }),
      { target: { value: "hidden-search-marker" } },
    );
    expect(region.querySelectorAll("li")).toHaveLength(1);
    expect(region.querySelector("details")?.open).toBe(false);
    expect(region.querySelector("summary")).not.toHaveTextContent(
      "hidden-search-marker",
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy displayed log" }));
    expect(mocks.clipboard).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Copy log text" })),
    );
    expect(mocks.clipboard).toHaveBeenCalledOnce();
    const text = mocks.clipboard.mock.calls[0][0];
    expect(text).toContain(message);
    expect(text).toContain(continuation);
    expect(text).toContain(archiveName);
    expect(text).not.toContain("Current connection ready");
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search log text" }),
      { target: { value: "no-such-record" } },
    );
    expect(region.querySelectorAll("li")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Copy displayed log" }),
    ).toBeDisabled();
  });
});
