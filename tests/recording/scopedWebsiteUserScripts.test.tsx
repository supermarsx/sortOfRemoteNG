import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useWebsiteUserScripts,
  type WebsiteUserScriptsLibraryBinding,
} from "../../src/hooks/recording/useWebsiteUserScripts";
import WebsiteUserScriptsPanel from "../../src/components/recording/scriptManager/WebsiteUserScriptsPanel";
import type {
  AutomationLibraryApi,
  AutomationLibrarySnapshot,
  AutomationScope,
} from "../../src/types/recording/automationLibrary";
const h = vi.hoisted(() => ({ legacyLoad: vi.fn(), native: vi.fn() }));
vi.mock("../../src/contexts/SettingsContext", () => ({
  useSettings: () => ({ settingsReady: true }),
}));
vi.mock("../../src/utils/tauri/invoke", () => ({ getInvoke: h.native }));
vi.mock("../../src/utils/recording/webAutomationLibrary", () => ({
  webAutomationStore: { load: h.legacyLoad },
  WEB_AUTOMATION_STORE_KEY: "recording.web-automation.v1",
  MAX_WEB_SCRIPT_BYTES: 65536,
  saveWebAutomationItem: vi.fn(),
  deleteWebAutomationItem: vi.fn(),
}));
vi.mock("../../src/components/ui/editor/ScriptCodeEditor", () => ({
  default: ({
    code,
    onChange,
    ariaLabel,
    readOnly,
  }: {
    code: string;
    onChange: (value: string) => void;
    ariaLabel: string;
    readOnly?: boolean;
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={code}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
const script = {
  id: "same-id",
  kind: "script" as const,
  name: "Fixture",
  description: "",
  code: "document.title",
  createdAt: "2026-09-10T00:00:00Z",
  updatedAt: "2026-09-10T00:00:00Z",
};
const snapshot = (
  scope: AutomationScope = { kind: "database", databaseId: "database-a" },
): AutomationLibrarySnapshot<"website-script"> => ({
  scope,
  family: "website-script",
  receipt: "receipt-a",
  entries: [
    {
      family: "website-script",
      payload: script,
      provenance: { publisher: "Claimed source" },
    },
  ],
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
function mount(initial: Partial<WebsiteUserScriptsLibraryBinding> = {}) {
  const read = vi.fn(async (_scope: AutomationScope, _family: string) =>
    snapshot(_scope),
  );
  const apply = vi.fn(
    async (_snapshot: AutomationLibrarySnapshot, _changes: unknown) => ({
      ...snapshot(_snapshot.scope),
      receipt: "receipt-new",
    }),
  );
  let binding: WebsiteUserScriptsLibraryBinding = {
    api: { read, apply } as AutomationLibraryApi,
    scope: { kind: "database", databaseId: "database-a" },
    enabled: true,
    settingsReady: true,
    diagnostic: null,
    retry: vi.fn(),
    accessKey: "database-a:1",
    databaseRevision: 0,
    ...initial,
  };
  const view = renderHook(() => useWebsiteUserScripts(binding));
  return {
    ...view,
    read,
    apply,
    update(next: Partial<WebsiteUserScriptsLibraryBinding>) {
      binding = { ...binding, ...next };
      view.rerender();
    },
  };
}
beforeEach(() => vi.clearAllMocks());
describe("explicit scoped website script management", () => {
  it("shows the explicit database destination, keeps dirty drafts on background refresh, and clears them on revocation", async () => {
    const scope = { kind: "database" as const, databaseId: "database-a" };
    const read = vi.fn(async () => snapshot(scope));
    const library: WebsiteUserScriptsLibraryBinding = {
      api: { read, apply: vi.fn() } as AutomationLibraryApi,
      scope,
      enabled: true,
      settingsReady: true,
      diagnostic: null,
      retry: vi.fn(),
      accessKey: "a:1",
      databaseRevision: 0,
    };
    const dirty = vi.fn();
    const view = render(
      <WebsiteUserScriptsPanel library={library} onDirtyChange={dirty} />,
    );
    await screen.findByRole("button", { name: "New website script" });
    expect(screen.getByTitle("database-a")).toHaveTextContent(
      "Selected database",
    );
    fireEvent.click(screen.getByRole("button", { name: "New website script" }));
    fireEvent.change(screen.getByLabelText("Script name"), {
      target: { value: "Unsaved private draft" },
    });
    fireEvent.change(screen.getByLabelText("Website JavaScript"), {
      target: { value: "document.title" },
    });
    expect(dirty).toHaveBeenLastCalledWith(true);
    view.rerender(
      <WebsiteUserScriptsPanel
        library={{ ...library, databaseRevision: 1 }}
        onDirtyChange={dirty}
      />,
    );
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("Script name")).toHaveValue(
      "Unsaved private draft",
    );
    view.rerender(
      <WebsiteUserScriptsPanel
        library={{
          ...library,
          enabled: false,
          accessKey: "locked",
          diagnostic: { code: "locked", message: "locked", retryable: true },
        }}
        onDirtyChange={dirty}
      />,
    );
    expect(screen.queryByLabelText("Script name")).not.toBeInTheDocument();
    expect(
      screen.getByText("Selected database library access changed"),
    ).toBeInTheDocument();
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(h.legacyLoad).not.toHaveBeenCalled();
  });
  it("reads only the chosen family/scope and replaces through the reviewed receipt with provenance intact", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.read).toHaveBeenCalledWith(
      { kind: "database", databaseId: "database-a" },
      "website-script",
    );
    expect(h.legacyLoad).not.toHaveBeenCalled();
    expect(h.native).not.toHaveBeenCalled();
    await act(async () => {
      expect(
        await view.result.current.save({ ...script, name: "Updated" }, script),
      ).toBe(true);
    });
    expect(view.apply).toHaveBeenCalledWith(snapshot(), [
      {
        operation: "put",
        entry: {
          family: "website-script",
          payload: { ...script, name: "Updated" },
          provenance: { publisher: "Claimed source" },
        },
        expected: snapshot().entries[0],
      },
    ]);
  });
  it("does not infer an app fallback when an explicitly chosen database is unavailable", async () => {
    const retry = vi.fn();
    const view = mount({
      enabled: false,
      diagnostic: {
        code: "database-unavailable",
        message: "Unlock chosen database",
        retryable: true,
      },
      retry,
    });
    expect(view.read).not.toHaveBeenCalled();
    expect(view.result.current.ready).toBe(false);
    expect(view.result.current.diagnostic?.code).toBe("database-unavailable");
    await act(async () => view.result.current.reload());
    expect(retry).toHaveBeenCalledOnce();
    expect(h.legacyLoad).not.toHaveBeenCalled();
  });
  it("removes only the selected native script and rejects stale same-ID edits after a scope switch", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    const staleSave = view.result.current.save;
    await act(async () => {
      expect(await view.result.current.remove(script)).toBe(true);
    });
    expect(view.apply.mock.calls[0][1]).toEqual([
      { operation: "delete", expected: snapshot().entries[0] },
    ]);
    view.apply.mockClear();
    view.update({
      scope: { kind: "database", databaseId: "database-b" },
      accessKey: "database-b:1",
    });
    expect(view.result.current.scripts).toEqual([]);
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => {
      expect(await staleSave(script, script)).toBe(false);
    });
    expect(view.apply).not.toHaveBeenCalled();
  });
  it("keeps drafts mounted while a normal database revision reload is pending", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    const epoch = view.result.current.epoch;
    const next = deferred<AutomationLibrarySnapshot<"website-script">>();
    view.read.mockReturnValueOnce(next.promise);
    view.update({ databaseRevision: 1 });
    expect(view.result.current.ready).toBe(true);
    expect(view.result.current.epoch).toBe(epoch);
    await act(async () => next.resolve({ ...snapshot(), entries: [] }));
    expect(view.result.current.scripts).toEqual([]);
    expect(view.result.current.ready).toBe(true);
  });
  it("masks access immediately and ignores late loads through lock/unlock ABA", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    const pending = deferred<AutomationLibrarySnapshot<"website-script">>();
    view.read.mockReturnValueOnce(pending.promise);
    let reload!: Promise<void>;
    act(() => {
      reload = view.result.current.reload();
    });
    view.update({ enabled: false, accessKey: "locked" });
    expect(view.result.current.scripts).toEqual([]);
    await act(async () => {
      pending.resolve(snapshot());
      await reload;
    });
    expect(view.result.current.ready).toBe(false);
    view.update({ enabled: true, accessKey: "unlocked" });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
  });
  it("retries the new owner load after a previous owner's pending write settles", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    const pending = deferred<AutomationLibrarySnapshot<"website-script">>();
    view.apply.mockReturnValueOnce(pending.promise);
    let save!: Promise<boolean>;
    act(() => {
      save = view.result.current.save(script, script);
    });
    view.update({
      scope: { kind: "database", databaseId: "database-b" },
      accessKey: "database-b:1",
    });
    await act(async () => {
      pending.resolve(snapshot());
      expect(await save).toBe(false);
    });
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    expect(view.result.current.scope).toEqual({
      kind: "database",
      databaseId: "database-b",
    });
    expect(view.read).toHaveBeenLastCalledWith(
      { kind: "database", databaseId: "database-b" },
      "website-script",
    );
    expect(view.result.current.busy).toBe(false);
  });
  it("requires reload after a refused one-use receipt and never reports failed saves as success", async () => {
    const view = mount();
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    view.apply.mockRejectedValueOnce(new Error("library changed"));
    await act(async () => {
      expect(await view.result.current.save(script, script)).toBe(false);
    });
    expect(view.result.current.error).toBeTruthy();
    await act(async () => {
      expect(await view.result.current.save(script, script)).toBe(false);
    });
    expect(view.apply).toHaveBeenCalledOnce();
    await act(async () => view.result.current.reload());
    await act(async () => {
      expect(await view.result.current.save(script, script)).toBe(true);
    });
  });
});
