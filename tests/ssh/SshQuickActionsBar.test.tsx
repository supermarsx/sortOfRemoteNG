import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SshQuickActionsBar from "../../src/components/ssh/webTerminal/SshQuickActionsBar";
import type { useSshQuickActions } from "../../src/hooks/ssh/useSshQuickActions";
vi.mock("../../src/components/recording/ScriptManager", () => ({
  ScriptManager: () => <div>Script library manager</div>,
}));
vi.mock("../../src/components/recording/MacroManager", () => ({
  MacroManager: () => <div>Macro library manager</div>,
}));
const item = {
  id: "script",
  kind: "script" as const,
  name: "Inspect",
  description: "Read status",
  missing: false,
};
const actions = (): ReturnType<typeof useSshQuickActions> => ({
  enabled: true,
  unavailable: null,
  error: null,
  busy: false,
  loading: false,
  query: "",
  setQuery: vi.fn(),
  favorites: [item],
  visibleFavorites: [item],
  available: [{ ...item, id: "macro", kind: "macro", name: "Checklist" }],
  canRun: true,
  add: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
  run: vi.fn(),
  refresh: vi.fn(),
});
describe("SSH favorites bar", () => {
  it("shows compact explicit run/search/add controls without executing on mount", () => {
    const model = actions();
    render(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    expect(model.run).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search SSH favorites" }),
      { target: { value: "inspect" } },
    );
    expect(model.setQuery).toHaveBeenCalledWith("inspect");
    fireEvent.click(screen.getByRole("button", { name: "Run script Inspect" }));
    expect(model.run).toHaveBeenCalledExactlyOnceWith(item);
  });
  it("adds/removes/orders references and exposes both library managers without running", async () => {
    const model = actions();
    model.favorites.push({ ...item, id: "second", name: "Second" });
    render(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add or manage SSH favorites" }),
    );
    expect(
      screen.getByRole("dialog", { name: "SSH favorites" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Add macro Checklist" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move Inspect later" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Remove favorite Inspect" }),
    );
    expect(model.add).toHaveBeenCalledWith(model.available[0]);
    expect(model.move).toHaveBeenCalledWith(item, 1);
    expect(model.remove).toHaveBeenCalledWith(item);
    expect(model.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Manage macros" }));
    expect(
      await screen.findByText("Macro library manager"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to favorites" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage scripts" }));
    expect(
      await screen.findByText("Script library manager"),
    ).toBeInTheDocument();
  });
  it("keeps an empty enabled entry point and hides the feature only when globally disabled", () => {
    const model = actions();
    model.favorites = [];
    model.visibleFavorites = [];
    const view = render(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Add or manage SSH favorites" }),
    ).toBeEnabled();
    view.rerender(
      <SshQuickActionsBar
        actions={{ ...model, enabled: false }}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("ssh-quick-actions")).not.toBeInTheDocument();
  });
  it("disables unavailable entries and exposes immediate replay cancellation", () => {
    const model = actions();
    model.visibleFavorites = [{ ...item, missing: true }];
    const stop = vi.fn();
    render(
      <SshQuickActionsBar actions={model} replaying onStopReplay={stop} />,
    );
    expect(
      screen.getByRole("button", { name: "Run script Inspect" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop macro replay" }));
    expect(stop).toHaveBeenCalledOnce();
  });
  it("unmounts private library managers immediately when the owning database becomes unavailable", async () => {
    const model = actions();
    const view = render(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Add or manage SSH favorites" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Manage scripts" }));
    expect(
      await screen.findByText("Script library manager"),
    ).toBeInTheDocument();
    view.rerender(
      <SshQuickActionsBar
        actions={{ ...model, unavailable: "Owning database locked" }}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("Script library manager"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
