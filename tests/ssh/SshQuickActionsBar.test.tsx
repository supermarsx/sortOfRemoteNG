import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
  it.each(["script", "macro"] as const)(
    "assigns only %s choices from the empty-space context menu without running",
    (kind) => {
      const model = actions();
      const script = { ...item, id: "assign", name: "Chosen script" };
      const macro = {
        ...item,
        id: "assign",
        kind: "macro" as const,
        name: "Chosen macro",
      };
      model.favorites = [];
      model.visibleFavorites = [];
      model.available = [script, macro];
      render(
        <SshQuickActionsBar
          actions={model}
          replaying={false}
          onStopReplay={vi.fn()}
        />,
      );
      fireEvent.contextMenu(
        screen.getByText("Add scripts or macros for this connection"),
        { clientX: 24, clientY: 48 },
      );
      const menu = screen.getByRole("menu", { name: "SSH favorites actions" });
      expect(menu).toHaveClass("sor-menu-surface");
      expect(
        within(menu).getByRole("menuitem", { name: `Assign ${kind}` }),
      ).toHaveClass("sor-menu-item");
      expect(within(menu).queryByText(/folder/i)).not.toBeInTheDocument();
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: `Assign ${kind}` }),
      );
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      const dialog = screen.getByRole("dialog", { name: `Assign SSH ${kind}` });
      const choices = within(dialog).getByLabelText("Available SSH actions");
      expect(within(choices).getAllByRole("button")).toHaveLength(1);
      fireEvent.click(
        within(choices).getByRole("button", {
          name: `Add ${kind} Chosen ${kind}`,
        }),
      );
      expect(model.add).toHaveBeenCalledExactlyOnceWith(
        kind === "script" ? script : macro,
      );
      expect(model.run).not.toHaveBeenCalled();
    },
  );
  it.each(["ContextMenu", "F10"])(
    "opens via %s and restores focus on Escape, then closes on outside click",
    async (key) => {
      const model = actions();
      render(
        <SshQuickActionsBar
          actions={model}
          replaying={false}
          onStopReplay={vi.fn()}
        />,
      );
      const bar = screen.getByRole("group", { name: "SSH favorites bar" });
      bar.focus();
      fireEvent.keyDown(bar, { key, shiftKey: key === "F10" });
      const assign = screen.getByRole("menuitem", { name: "Assign script" });
      await waitFor(() => expect(assign).toHaveFocus());
      fireEvent.keyDown(assign, { key: "ArrowDown" });
      expect(
        screen.getByRole("menuitem", { name: "Assign macro" }),
      ).toHaveFocus();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(bar).toHaveFocus();
      fireEvent.contextMenu(bar);
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(model.run).not.toHaveBeenCalled();
    },
  );
  it("leaves native input and control context menus alone", () => {
    render(
      <SshQuickActionsBar
        actions={actions()}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    expect(
      fireEvent.contextMenu(
        screen.getByRole("textbox", { name: "Search SSH favorites" }),
      ),
    ).toBe(true);
    expect(
      fireEvent.contextMenu(
        screen.getByRole("button", { name: "Add or manage SSH favorites" }),
      ),
    ).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
  it("dispatches exact scoped item context actions and respects reorder boundaries", () => {
    const model = actions();
    const scoped = {
      ...item,
      scope: { kind: "database" as const, databaseId: "owner" },
    };
    model.favorites = [item, scoped];
    model.visibleFavorites = model.favorites;
    render(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    const chips = screen.getAllByRole("button", { name: "Run script Inspect" });
    fireEvent.contextMenu(chips[1]);
    expect(screen.getByRole("menuitem", { name: "Move later" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move earlier" }));
    expect(model.move).toHaveBeenCalledExactlyOnceWith(scoped, -1);
    fireEvent.contextMenu(chips[0]);
    expect(
      screen.getByRole("menuitem", { name: "Move earlier" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move later" }));
    expect(model.move).toHaveBeenLastCalledWith(item, 1);
    fireEvent.contextMenu(chips[1]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove favorite" }));
    expect(model.remove).toHaveBeenCalledExactlyOnceWith(scoped);
    expect(model.run).not.toHaveBeenCalled();
    fireEvent.keyDown(chips[1], { key: "ContextMenu" });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Run script Inspect" }),
    );
    expect(model.run).toHaveBeenCalledExactlyOnceWith(scoped);
  });
  it("keeps unavailable favorite management keyboard-accessible without enabling execution", () => {
    const model = actions();
    const missing = { ...item, missing: true };
    model.favorites = [missing];
    model.visibleFavorites = model.favorites;
    render(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    const chip = screen.getByRole("group", { name: "script Inspect favorite" });
    expect(chip).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(chip, { key: "F10", shiftKey: true });
    expect(
      screen.getByRole("menuitem", { name: "Run script Inspect" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Run script Inspect" }),
    );
    expect(model.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove favorite" }));
    expect(model.remove).toHaveBeenCalledWith(missing);
  });
  it.each(["Manage favorites", "Manage scripts", "Manage macros"])(
    "opens %s from bar context without execution",
    async (label) => {
      const model = actions();
      render(
        <SshQuickActionsBar
          actions={model}
          replaying={false}
          onStopReplay={vi.fn()}
        />,
      );
      fireEvent.contextMenu(screen.getByTestId("ssh-quick-actions"));
      fireEvent.click(screen.getByRole("menuitem", { name: label }));
      expect(
        screen.getByRole("dialog", {
          name: label === "Manage favorites" ? "SSH favorites" : label,
        }),
      ).toBeInTheDocument();
      if (label === "Manage scripts")
        await screen.findByText("Script library manager");
      if (label === "Manage macros")
        await screen.findByText("Macro library manager");
      expect(model.run).not.toHaveBeenCalled();
    },
  );
  it.each([
    "busy",
    "loading",
    "replaying",
    "unavailable",
    "disabled",
    "owner",
    "library",
  ])(
    "drops an open context review after %s and never revives it after recovery",
    (reason) => {
      const model = actions();
      const view = render(
        <SshQuickActionsBar
          actions={model}
          replaying={false}
          onStopReplay={vi.fn()}
        />,
      );
      fireEvent.contextMenu(
        screen.getByRole("button", { name: "Run script Inspect" }),
      );
      const run = screen.getByRole("menuitem", { name: "Run script Inspect" });
      const changed = { ...model };
      if (reason === "busy") changed.busy = true;
      if (reason === "loading") changed.loading = true;
      if (reason === "unavailable")
        changed.unavailable = "Owning database locked";
      if (reason === "disabled") changed.enabled = false;
      if (reason === "owner") {
        changed.remove = vi.fn();
        changed.run = vi.fn();
      }
      if (reason === "library") changed.favorites = [...model.favorites];
      view.rerender(
        <SshQuickActionsBar
          actions={changed}
          replaying={reason === "replaying"}
          onStopReplay={vi.fn()}
        />,
      );
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      fireEvent.click(run);
      view.rerender(
        <SshQuickActionsBar
          actions={model}
          replaying={false}
          onStopReplay={vi.fn()}
        />,
      );
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(model.run).not.toHaveBeenCalled();
      expect(changed.run).not.toHaveBeenCalled();
    },
  );
  it("closes a kind-filtered assignment on owner callback replacement without exposing the new owner's choices", () => {
    const model = actions();
    const view = render(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    fireEvent.contextMenu(screen.getByTestId("ssh-quick-actions"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Assign macro" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const other = {
      ...model,
      remove: vi.fn(),
      run: vi.fn(),
      available: [{ ...item, name: "Other owner" }],
    };
    view.rerender(
      <SshQuickActionsBar
        actions={other}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Other owner")).not.toBeInTheDocument();
    view.rerender(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("renders distinct same-ID scope choices and dispatches the exact clicked reference", () => {
    const model = actions();
    const scoped = {
      ...item,
      scope: { kind: "database" as const, databaseId: "owner" },
    };
    model.favorites = [item, scoped];
    model.visibleFavorites = model.favorites;
    render(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    const choices = screen.getAllByRole("button", {
      name: "Run script Inspect",
    });
    expect(choices).toHaveLength(2);
    expect(choices[0]).toHaveAttribute(
      "title",
      expect.stringContaining("App-wide"),
    );
    expect(choices[1]).toHaveAttribute(
      "title",
      expect.stringContaining("Database"),
    );
    fireEvent.click(choices[1]);
    expect(model.run).toHaveBeenCalledWith(scoped);
  });
  it("styles manager navigation consistently and keeps only the header close with Escape support", async () => {
    const model = actions();
    render(
      <SshQuickActionsBar
        actions={model}
        replaying={false}
        onStopReplay={vi.fn()}
      />,
    );
    const open = () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Add or manage SSH favorites" }),
      );
    open();
    for (const label of ["Manage scripts", "Manage macros"]) {
      expect(screen.getByRole("button", { name: label })).toHaveClass(
        "sor-btn",
        "sor-btn-secondary",
        "text-xs",
      );
    }
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Manage scripts" }));
    await screen.findByText("Script library manager");
    expect(
      screen.getByRole("button", { name: "Back to favorites" }),
    ).toHaveClass("sor-btn", "sor-btn-secondary");
    expect(screen.getAllByRole("button", { name: "Close" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(model.run).not.toHaveBeenCalled();
  });
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
