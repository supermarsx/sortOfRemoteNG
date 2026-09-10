import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useScriptManager } from "../../src/hooks/recording/useScriptManager";
import { ScriptManager } from "../../src/components/recording/ScriptManager";
import { DefaultScriptCatalog } from "../../src/components/recording/scriptManager/DefaultScriptCatalog";
import { defaultScripts } from "../../src/data/defaultScripts";
import type {
  AutomationEntry,
  AutomationLibrarySnapshot,
  AutomationScope,
} from "../../src/types/recording/automationLibrary";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
const h = vi.hoisted(() => ({
  read: vi.fn(),
  apply: vi.fn(),
  ready: true,
  settingsReady: true,
  accessEpoch: 1,
  databaseRevision: 0,
  databaseScope: { databaseId: "db-a", generation: 1 } as {
    databaseId: string;
    generation: number;
  } | null,
}));
vi.mock("../../src/hooks/recording/useAutomationLibraryApi", () => ({
  useAutomationLibraryApi: () => ({
    ...h,
    api: { read: h.read, apply: h.apply },
    diagnostic: null,
    retry: vi.fn(),
  }),
}));
vi.mock(
  "../../src/components/recording/scriptManager/WebsiteUserScriptsPanel",
  () => ({
    default: ({
      library,
    }: {
      library: { scope: AutomationScope; enabled: boolean };
    }) => (
      <div data-testid="website-binding">
        {JSON.stringify(library.scope)} enabled:{String(library.enabled)}
      </div>
    ),
  }),
);
vi.mock(
  "../../src/components/recording/scriptManager/RepositoryCatalogPanel",
  () => ({
    default: ({
      scope,
      family,
    }: {
      scope: AutomationScope;
      family: string;
    }) => (
      <div data-testid="repository-binding">
        {family}:{JSON.stringify(scope)}
      </div>
    ),
  }),
);
vi.mock("../../src/components/ui/editor/ScriptCodeEditor", () => ({
  default: ({
    code,
    onChange,
  }: {
    code: string;
    onChange: (code: string) => void;
  }) => (
    <textarea
      aria-label="Script code"
      value={code}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [], sessions: [] },
    dispatch: vi.fn(),
  }),
}));
const entry: AutomationEntry<"terminal-script"> = {
  family: "terminal-script",
  payload: { ...defaultScripts[0], id: "custom-scoped", name: "App fixture" },
  provenance: { sourceId: "fixture", platforms: ["linux"] },
};
const snapshot = (
  scope: AutomationScope,
  entries = [entry],
): AutomationLibrarySnapshot<"terminal-script"> => ({
  scope,
  family: "terminal-script",
  receipt: crypto.randomUUID(),
  entries: structuredClone(entries),
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
};
beforeEach(() => {
  vi.clearAllMocks();
  h.ready = true;
  h.settingsReady = true;
  h.accessEpoch = 1;
  h.databaseRevision = 0;
  h.databaseScope = { databaseId: "db-a", generation: 1 };
  h.read.mockImplementation(async (scope) =>
    snapshot(scope, scope.kind === "app" ? [entry] : []),
  );
  h.apply.mockImplementation(async (reviewed, changes) => ({
    ...reviewed,
    receipt: "saved",
    entries: changes.flatMap((change: { operation: string; entry: unknown }) =>
      change.operation === "put" ? [change.entry] : [],
    ),
  }));
});
async function hook() {
  const view = renderHook(() => useScriptManager(vi.fn()));
  await waitFor(() => expect(view.result.current.ready).toBe(true));
  return view;
}
describe("explicit script library scopes", () => {
  it("loads an empty database without copying app defaults or creating a fallback", async () => {
    const { result } = await hook();
    expect(result.current.scripts[0].name).toBe("App fixture");
    act(() =>
      result.current.changeScope({ kind: "database", databaseId: "db-a" }),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.scripts).toEqual([]);
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.read).toHaveBeenLastCalledWith(
      { kind: "database", databaseId: "db-a" },
      "terminal-script",
    );
  });
  it("does not expose a writable default library when the read is refused", async () => {
    h.read.mockRejectedValue(
      new Error("Locked: private path and script must not escape"),
    );
    const { result } = renderHook(() => useScriptManager(vi.fn()));
    await waitFor(() => expect(result.current.storageError).not.toBeNull());
    expect(result.current.scripts).toEqual([]);
    expect(result.current.ready).toBe(false);
    expect(result.current.storageError).not.toContain("private path");
    act(() => result.current.handleNewScript());
    expect(result.current.isEditing).toBe(false);
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("preserves exact reviewed provenance and waits for durable save before closing a draft", async () => {
    const { result } = await hook();
    act(() => result.current.handleEditScript(result.current.scripts[0]));
    act(() => result.current.setEditName("Edited"));
    const gate = deferred<AutomationLibrarySnapshot<"terminal-script">>();
    h.apply.mockReturnValueOnce(gate.promise);
    let pending!: Promise<boolean>;
    act(() => {
      pending = result.current.handleSaveScript();
    });
    await waitFor(() => expect(h.apply).toHaveBeenCalledOnce());
    expect(result.current.isEditing).toBe(true);
    expect(h.apply.mock.calls[0][1][0]).toEqual(
      expect.objectContaining({
        expected: entry,
        entry: expect.objectContaining({ provenance: entry.provenance }),
      }),
    );
    await act(async () => {
      gate.resolve(snapshot({ kind: "app" }));
      expect(await pending).toBe(true);
    });
    expect(result.current.isEditing).toBe(false);
  });
  it("retains failed-save drafts and rejects a changed saved base", async () => {
    const { result } = await hook();
    act(() => result.current.handleEditScript(result.current.scripts[0]));
    act(() => result.current.setEditName("Retained draft"));
    h.apply.mockRejectedValueOnce(new Error("durable write failed"));
    await act(async () => {
      expect(await result.current.handleSaveScript()).toBe(false);
    });
    expect(result.current.editName).toBe("Retained draft");
    expect(result.current.storageError).toContain("retained");
    h.apply.mockClear();
    h.read.mockResolvedValueOnce(
      snapshot({ kind: "app" }, [
        { ...entry, payload: { ...entry.payload, script: "echo changed" } },
      ]),
    );
    await act(async () => result.current.handleSaveScript());
    expect(h.apply).not.toHaveBeenCalled();
    expect(result.current.isEditing).toBe(true);
  });
  it("blocks a pending save and retained delete confirmation after lock/unlock ABA", async () => {
    const view = await hook();
    act(() => view.result.current.handleDeleteScript(entry.payload.id));
    const oldConfirm = view.result.current.confirmReview;
    h.accessEpoch++;
    view.rerender();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    act(() => oldConfirm());
    expect(h.apply).not.toHaveBeenCalled();
    act(() =>
      view.result.current.handleEditScript(view.result.current.scripts[0]),
    );
    const gate = deferred<AutomationLibrarySnapshot<"terminal-script">>();
    h.read.mockReturnValueOnce(gate.promise);
    let pending!: Promise<boolean>;
    act(() => {
      pending = view.result.current.handleSaveScript();
    });
    h.accessEpoch++;
    view.rerender();
    expect(view.result.current.editScript).toBe("");
    await act(async () => {
      gate.resolve(snapshot({ kind: "app" }));
      expect(await pending).toBe(false);
    });
    expect(h.apply).not.toHaveBeenCalled();
  });
  it("keeps app drafts across unrelated database changes but masks owning DB drafts", async () => {
    const view = await hook();
    act(() =>
      view.result.current.handleEditScript(view.result.current.scripts[0]),
    );
    h.databaseScope = { databaseId: "db-b", generation: 2 };
    view.rerender();
    expect(view.result.current.isEditing).toBe(true);
    act(() => {
      view.result.current.discardEdit();
      view.result.current.changeScope({ kind: "database", databaseId: "db-b" });
    });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    act(() => view.result.current.handleNewScript());
    h.databaseScope = null;
    view.rerender();
    expect(view.result.current.isEditing).toBe(false);
    expect(view.result.current.scripts).toEqual([]);
  });
  it("requires scope discard and passes the exact selected scope into Website management", async () => {
    render(<ScriptManager isOpen onClose={vi.fn()} />);
    await screen.findByText("App fixture");
    fireEvent.click(screen.getByRole("button", { name: "New Script" }));
    fireEvent.change(screen.getByPlaceholderText(/Enter script name/i), {
      target: { value: "Draft" },
    });
    fireEvent.change(
      screen.getByRole("combobox", { name: "Script library scope" }),
      { target: { value: "db-a" } },
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Script library scope" }),
      ).toHaveValue("db-a"),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Website userscripts" }));
    expect(screen.getByTestId("website-binding")).toHaveTextContent(
      '"databaseId":"db-a"',
    );
  });
  it("imports bundled managed templates through the selected DB receipt with original IDs", async () => {
    const onApplied = vi.fn();
    const scope = { kind: "database" as const, databaseId: "db-a" };
    render(
      <DefaultScriptCatalog
        library={{
          api: { read: h.read, apply: h.apply },
          scope,
          accessKey: "db-a:1",
          enabled: true,
        }}
        onApplied={onApplied}
      />,
    );
    await waitFor(() => expect(h.read).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: `Select ${defaultScripts[0].name}`,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Import / restore 1 selected" }),
    );
    await waitFor(() => expect(h.apply).toHaveBeenCalledOnce());
    expect(h.apply.mock.calls[0][0].scope).toEqual(scope);
    expect(h.apply.mock.calls[0][1][0].entry.payload).toEqual(
      defaultScripts[0],
    );
    expect(onApplied).toHaveBeenCalledOnce();
  });
  it("does not report an old scoped import as success after its owner is replaced", async () => {
    const onApplied = vi.fn(),
      gate = deferred<AutomationLibrarySnapshot<"terminal-script">>();
    h.apply.mockReturnValueOnce(gate.promise);
    const props = {
      api: { read: h.read, apply: h.apply },
      scope: { kind: "database" as const, databaseId: "db-a" },
      accessKey: "a:1",
      enabled: true,
    };
    const view = render(
      <DefaultScriptCatalog library={props} onApplied={onApplied} />,
    );
    await act(async () => {});
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: `Select ${defaultScripts[0].name}`,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Import / restore 1 selected" }),
    );
    await waitFor(() => expect(h.apply).toHaveBeenCalledOnce());
    view.rerender(
      <DefaultScriptCatalog
        library={{ ...props, accessKey: "a:2" }}
        onApplied={onApplied}
      />,
    );
    await act(async () => gate.resolve(snapshot(props.scope)));
    expect(onApplied).not.toHaveBeenCalled();
  });
  it("routes repository browsing by the explicit script kind and selected scope", async () => {
    render(<ScriptManager isOpen onClose={vi.fn()} />);
    await screen.findByText("App fixture");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Script library scope" }),
      { target: { value: "db-a" } },
    );
    fireEvent.click(screen.getByRole("tab", { name: "Browse scripts" }));
    fireEvent.click(
      screen.getByRole("tab", { name: "Repositories / packages" }),
    );
    await screen.findByTestId("repository-binding");
    fireEvent.change(screen.getByRole("combobox", { name: "Script kind" }), {
      target: { value: "website-script" },
    });
    expect(screen.getByTestId("repository-binding")).toHaveTextContent(
      'website-script:{"kind":"database","databaseId":"db-a"}',
    );
  });
});
