import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AutomationLibraryDiagnostic } from "../../src/types/recording/automationLibrary";
const h = vi.hoisted(() => ({
  ready: false,
  settingsReady: true,
  desktopAvailable: true as boolean | null,
  diagnostic: null as AutomationLibraryDiagnostic | null,
  reload: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../src/hooks/recording/useWebsiteUserScripts", () => ({
  useWebsiteUserScripts: () => ({
    ...h,
    scope: { kind: "app" },
    scripts: [],
    epoch: 1,
    busy: false,
    error: "Native secret/path details must never appear in the recovery UI",
  }),
}));
vi.mock("../../src/components/ui/editor/ScriptCodeEditor", () => ({
  default: () => null,
}));
import WebsiteUserScriptsPanel from "../../src/components/recording/scriptManager/WebsiteUserScriptsPanel";
beforeEach(() => {
  vi.clearAllMocks();
  h.ready = false;
  h.settingsReady = true;
  h.desktopAvailable = true;
  h.diagnostic = null;
  h.reload.mockResolvedValue(undefined);
});
describe("app-wide website library diagnostics and recovery", () => {
  it.each([
    ["initializing", /finish loading/],
    ["desktop-required", /installed desktop app/],
    ["backend-unavailable", /close and reopen/],
    ["locked", /unlock global app encryption/],
    ["recovery-required", /Do not delete, overwrite or reset/],
    ["invalid-library", /Do not reset it to an empty library/],
    ["access-changed", /Restore the expected app encryption/],
    ["conflict", /previous write may already have completed/],
    ["storage-unavailable", /configured data directory/],
  ] as const)(
    "explains %s using safe code and ordered recovery instructions",
    (code, instruction) => {
      h.diagnostic = {
        code,
        message: "Do not render raw native data",
        retryable: code !== "initializing",
      };
      h.settingsReady = code !== "initializing";
      render(<WebsiteUserScriptsPanel />);
      expect(screen.getByText(code)).toBeInTheDocument();
      expect(screen.getByText(instruction)).toBeInTheDocument();
      expect(screen.getByRole("list").querySelectorAll("li")).toHaveLength(2);
      expect(screen.getByText("App-wide")).toBeInTheDocument();
      expect(
        screen.queryByText(/Native secret|raw native data/),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "New website script" }),
      ).not.toBeInTheDocument();
      expect(h.reload).not.toHaveBeenCalled();
      expect(h.save).not.toHaveBeenCalled();
      expect(h.remove).not.toHaveBeenCalled();
      if (code === "initializing")
        expect(
          screen.queryByRole("button", { name: "Retry library" }),
        ).not.toBeInTheDocument();
    },
  );
  it("explicit retry is single-flight and never mutates or resets a library", async () => {
    let finish!: () => void;
    h.reload.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    h.diagnostic = { code: "locked", message: "", retryable: true };
    const { rerender } = render(<WebsiteUserScriptsPanel />);
    const retry = screen.getByRole("button", { name: "Retry library" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(h.reload).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
    await act(async () => finish());
    h.ready = true;
    h.diagnostic = null;
    rerender(<WebsiteUserScriptsPanel />);
    expect(
      screen.getByRole("button", { name: "New website script" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Library recovery guidance"),
    ).not.toBeInTheDocument();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.remove).not.toHaveBeenCalled();
  });
  it("does not instruct the user to unlock an owning database for app scope", () => {
    h.ready = true;
    render(<WebsiteUserScriptsPanel />);
    expect(
      screen.getByText(/independent of the currently open connection database/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/owning database/)).not.toBeInTheDocument();
  });
});
