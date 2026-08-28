import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import {
  MAX_BULK_SCRIPT_BYTES,
  MAX_BULK_SCRIPT_DESCRIPTION_LENGTH,
  MAX_BULK_SCRIPT_NAME_LENGTH,
  bulkScriptsStore,
  type BulkScript,
  type BulkScriptLibrarySnapshot,
} from "./bulkScriptLibrary";
import { useBulkSSHCommander } from "./useBulkSSHCommander";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  state: { sessions: [] as Array<Record<string, unknown>> },
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
  history: {
    addEntry: vi.fn(),
    navigateUp: vi.fn(() => null),
    navigateDown: vi.fn(() => null),
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../../contexts/useConnections", () => ({
  useConnections: () => ({ state: mocks.state }),
}));
vi.mock("../../contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: mocks.toast }),
}));
vi.mock("./useSSHCommandHistory", () => ({
  useSSHCommandHistory: () => mocks.history,
}));

const customScript: BulkScript = {
  id: "custom-lifecycle",
  name: "Lifecycle script",
  description: "Safe lifecycle fixture",
  script: "uname -a",
  category: "Custom",
  type: "system",
  risk: "standard",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const destructiveScript: BulkScript = {
  ...customScript,
  id: "custom-destructive",
  name: "Restart host",
  script: "reboot",
  risk: "destructive",
};

const initialSnapshot = (
  active: BulkScript[] = [customScript],
): BulkScriptLibrarySnapshot => ({
  version: 2,
  active,
  trash: [],
  config: {
    runConfirmation: "destructive-only",
    deleteConfirmation: "permanent-only",
  },
});

const cloneSnapshot = (
  snapshot: BulkScriptLibrarySnapshot,
): BulkScriptLibrarySnapshot => JSON.parse(JSON.stringify(snapshot));

describe("useBulkSSHCommander script-library lifecycle", () => {
  let durableSnapshot: BulkScriptLibrarySnapshot;

  beforeEach(() => {
    mocks.invoke.mockReset().mockResolvedValue(undefined);
    mocks.toast.error.mockReset();
    mocks.toast.warning.mockReset();
    mocks.history.addEntry.mockReset();
    mocks.state.sessions = [];
    durableSnapshot = initialSnapshot();
    vi.spyOn(bulkScriptsStore, "load").mockImplementation(async () => ({
      value: cloneSnapshot(durableSnapshot),
      sanitized: false,
    }));
    vi.spyOn(bulkScriptsStore, "save").mockImplementation(async (value) => {
      durableSnapshot = cloneSnapshot(value);
      return { value: cloneSnapshot(durableSnapshot), changed: false };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("seeds built-in scripts alongside user-created ones without overwriting them", async () => {
    const shadowing: BulkScript = {
      ...customScript,
      id: "custom-arista-transceivers",
      // Same display name as a built-in; the user's copy must still survive.
      name: "Arista EOS — Transceiver Inventory and Third-Party Status",
      script: "show interfaces status",
      category: "Arista",
      type: "arista",
    };
    durableSnapshot = initialSnapshot([customScript, shadowing]);

    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.scriptLibraryLoaded).toBe(true));

    const byScriptId = (id: string) =>
      result.current.savedScripts.filter((script) => script.id === id);

    // Built-ins are present...
    for (const id of [
      "default-arista-eos-transceiver-inventory",
      "default-arista-eos-third-party-transceiver-guarded",
      "default-arista-eos-third-party-transceiver-flash-guarded",
    ]) {
      expect(byScriptId(id), id).toHaveLength(1);
    }
    // ...and so is every persisted user script, unmodified.
    expect(byScriptId(customScript.id)).toHaveLength(1);
    expect(byScriptId(shadowing.id)).toEqual([
      expect.objectContaining({
        name: shadowing.name,
        script: shadowing.script,
      }),
    ]);
    expect(durableSnapshot.active).toEqual([customScript, shadowing]);

    // Built-ins are never written into the user's durable library.
    for (const script of durableSnapshot.active) {
      expect(script.id.startsWith("default-")).toBe(false);
    }
  });

  it("soft-deletes, restores, and permanently deletes custom scripts", async () => {
    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() =>
      expect(
        result.current.savedScripts.some(
          (script) => script.id === customScript.id,
        ),
      ).toBe(true),
    );

    await act(async () => result.current.deleteScript(customScript.id));
    expect(result.current.trashedScripts).toEqual([
      expect.objectContaining({
        id: customScript.id,
        deletedAt: expect.any(String),
      }),
    ]);
    expect(window.confirm).not.toHaveBeenCalled();

    await act(async () => result.current.restoreScript(customScript.id));
    expect(
      result.current.savedScripts.some(
        (script) => script.id === customScript.id,
      ),
    ).toBe(true);
    expect(result.current.trashedScripts).toEqual([]);

    await act(async () => result.current.deleteScript(customScript.id));
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    const savesBeforeCancel = vi.mocked(bulkScriptsStore.save).mock.calls
      .length;
    await act(async () =>
      result.current.permanentlyDeleteScript(customScript.id),
    );
    expect(vi.mocked(bulkScriptsStore.save)).toHaveBeenCalledTimes(
      savesBeforeCancel,
    );
    expect(result.current.trashedScripts).toHaveLength(1);

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await act(async () =>
      result.current.permanentlyDeleteScript(customScript.id),
    );
    expect(result.current.trashedScripts).toEqual([]);
  });

  it("persists confirmation policy changes with the active and trash state", async () => {
    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.scriptLibraryLoaded).toBe(true));
    expect(
      result.current.savedScripts.some(
        (script) => script.id === customScript.id,
      ),
    ).toBe(true);

    await act(async () => result.current.setScriptRunConfirmation("always"));
    await act(async () => result.current.setScriptDeleteConfirmation("never"));

    expect(result.current.scriptLibraryConfig).toEqual({
      runConfirmation: "always",
      deleteConfirmation: "never",
    });
    expect(vi.mocked(bulkScriptsStore.save)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        active: [expect.objectContaining({ id: customScript.id })],
        trash: [],
        config: {
          runConfirmation: "always",
          deleteConfirmation: "never",
        },
      }),
    );
  });

  it("rebases concurrent mutations and synchronizes sibling hook instances", async () => {
    vi.mocked(bulkScriptsStore.save).mockImplementation(async (value) => {
      durableSnapshot = cloneSnapshot(value);
      window.dispatchEvent(
        new CustomEvent(APP_DATA_STORE_CHANGED_EVENT, {
          detail: { key: bulkScriptsStore.key },
        }),
      );
      return { value: cloneSnapshot(durableSnapshot), changed: false };
    });

    const first = renderHook(() => useBulkSSHCommander(true));
    const second = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => {
      expect(first.result.current.scriptLibraryLoaded).toBe(true);
      expect(second.result.current.scriptLibraryLoaded).toBe(true);
    });

    await act(async () => {
      await Promise.all([
        first.result.current.deleteScript(customScript.id),
        second.result.current.setScriptRunConfirmation("always"),
      ]);
    });

    await waitFor(() => {
      expect(durableSnapshot.active).toEqual([]);
      expect(durableSnapshot.trash).toEqual([
        expect.objectContaining({ id: customScript.id }),
      ]);
      expect(durableSnapshot.config.runConfirmation).toBe("always");
      expect(first.result.current.trashedScripts).toHaveLength(1);
      expect(second.result.current.trashedScripts).toHaveLength(1);
      expect(first.result.current.scriptLibraryConfig.runConfirmation).toBe(
        "always",
      );
      expect(second.result.current.scriptLibraryConfig.runConfirmation).toBe(
        "always",
      );
    });
  });

  it("does not overwrite storage while the initial library load is pending", async () => {
    let resolveLoad!: (
      result: Awaited<ReturnType<typeof bulkScriptsStore.load>>,
    ) => void;
    vi.mocked(bulkScriptsStore.load).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const { result } = renderHook(() => useBulkSSHCommander(true));
    expect(result.current.scriptLibraryLoaded).toBe(false);

    await act(async () => result.current.setScriptRunConfirmation("always"));

    expect(vi.mocked(bulkScriptsStore.save)).not.toHaveBeenCalled();
    expect(mocks.toast.warning).toHaveBeenCalledWith(
      expect.stringContaining("still loading"),
    );

    await act(async () => {
      resolveLoad({ value: initialSnapshot(), sanitized: false });
    });
    await waitFor(() => expect(result.current.scriptLibraryLoaded).toBe(true));
  });

  it("rejects oversized script fields without clearing the editor", async () => {
    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.scriptLibraryLoaded).toBe(true));

    act(() => {
      result.current.setCommand("uname -a");
      result.current.setNewScriptName(
        "n".repeat(MAX_BULK_SCRIPT_NAME_LENGTH + 1),
      );
    });
    await act(async () => result.current.saveCurrentAsScript());

    act(() => {
      result.current.setNewScriptName("valid name");
      result.current.setNewScriptDescription(
        "d".repeat(MAX_BULK_SCRIPT_DESCRIPTION_LENGTH + 1),
      );
    });
    await act(async () => result.current.saveCurrentAsScript());

    const oversizedScript = "x".repeat(MAX_BULK_SCRIPT_BYTES + 1);
    act(() => {
      result.current.setNewScriptDescription("");
      result.current.setCommand(oversizedScript);
    });
    await act(async () => result.current.saveCurrentAsScript());

    expect(vi.mocked(bulkScriptsStore.save)).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledTimes(3);
    expect(result.current.newScriptName).toBe("valid name");
    expect(result.current.command).toBe(oversizedScript);
  });

  it("surfaces a sanitized save and keeps the script editor intact", async () => {
    vi.mocked(bulkScriptsStore.save).mockImplementationOnce(async (value) => ({
      value: { ...value, active: [] },
      changed: true,
    }));
    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.scriptLibraryLoaded).toBe(true));

    act(() => {
      result.current.setCommand("uname -a");
      result.current.setNewScriptName("keep this draft");
    });
    await act(async () => result.current.saveCurrentAsScript());

    expect(mocks.toast.error).toHaveBeenCalledWith(
      expect.stringContaining("rejected during sanitization"),
    );
    expect(result.current.command).toBe("uname -a");
    expect(result.current.newScriptName).toBe("keep this draft");
  });

  it("confirms destructive scripts before both loading and dispatching", async () => {
    mocks.state.sessions = [
      {
        id: "session-1",
        name: "server one",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-1",
        hostname: "server-one.example",
      },
    ];
    vi.mocked(bulkScriptsStore.load).mockResolvedValue({
      value: initialSnapshot([destructiveScript]),
      sanitized: false,
    });
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
      {};
    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(1));

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    act(() => result.current.loadScript(destructiveScript));
    expect(result.current.command).toBe("");

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    act(() => result.current.loadScript(destructiveScript));
    expect(result.current.command).toBe("reboot");

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await act(async () => result.current.executeCommand());
    expect(mocks.invoke).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await act(async () => result.current.executeCommand());
    expect(mocks.invoke).toHaveBeenCalledWith("send_ssh_input", {
      sessionId: "backend-1",
      data: "reboot\n",
    });
  });

  it("prunes removed recipients and keeps output/history metadata live", async () => {
    mocks.state.sessions = [
      {
        id: "session-1",
        name: "server one",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-1",
        hostname: "server-one.example",
      },
      {
        id: "session-2",
        name: "server two",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-2",
        hostname: "server-two.example",
      },
    ];
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
      {};
    const { result, rerender } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(2));
    expect(result.current.activeOutputTab).toBe("session-1");

    act(() => result.current.toggleSessionSelection("session-1"));
    await waitFor(() =>
      expect(result.current.activeOutputTab).toBe("session-2"),
    );

    mocks.state.sessions = [mocks.state.sessions[1]];
    rerender();
    await waitFor(() => {
      expect(result.current.selectedSessionIds).toEqual(new Set(["session-2"]));
      expect(result.current.activeOutputTab).toBe("session-2");
      expect(result.current.sessionOutputs).not.toHaveProperty("session-1");
    });

    act(() => result.current.setCommand("hostname"));
    await act(async () => result.current.executeCommand());

    expect(mocks.invoke).toHaveBeenCalledWith("send_ssh_input", {
      sessionId: "backend-2",
      data: "hostname\n",
    });
    expect(result.current.commandHistory[0].sessionIds).toEqual(["session-2"]);
    expect(mocks.history.addEntry).toHaveBeenCalledWith("hostname", [
      expect.objectContaining({ sessionId: "session-2" }),
    ]);
  });

  it("clears a prior dispatch error when a later terminal peek succeeds", async () => {
    mocks.state.sessions = [
      {
        id: "session-preview",
        name: "preview host",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-preview",
      },
    ];
    (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
      {};
    mocks.invoke.mockRejectedValueOnce(new Error("dispatch unavailable"));
    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(1));

    act(() => result.current.setCommand("hostname"));
    await act(async () => result.current.executeCommand());
    expect(result.current.sessionOutputs["session-preview"].error).toBe(
      "dispatch unavailable",
    );

    mocks.invoke.mockResolvedValueOnce("fresh preview");
    await act(async () => result.current.peekSession("session-preview"));
    expect(result.current.sessionOutputs["session-preview"]).toMatchObject({
      output: "fresh preview",
      error: undefined,
      previewedAt: expect.any(Date),
    });
  });

  it("clears preview state and ignores a late in-flight peek response", async () => {
    mocks.state.sessions = [
      {
        id: "session-preview",
        name: "preview host",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-preview",
      },
    ];
    let resolvePreview!: (value: string) => void;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolvePreview = resolve;
        }),
    );
    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(1));

    let peekPromise!: Promise<void>;
    act(() => {
      peekPromise = result.current.peekSession("session-preview");
    });
    await waitFor(() =>
      expect(result.current.previewLoadingSessionIds).toEqual(
        new Set(["session-preview"]),
      ),
    );

    act(() => result.current.clearOutputs());
    expect(result.current.previewLoadingSessionIds).toEqual(new Set());
    expect(result.current.previewErrors).toEqual({});
    expect(result.current.previewSessionId).toBeNull();
    expect(result.current.sessionOutputs["session-preview"]).toMatchObject({
      output: "",
      status: "idle",
    });

    await act(async () => {
      resolvePreview("late terminal output");
      await peekPromise;
    });
    expect(result.current.sessionOutputs["session-preview"]).toMatchObject({
      output: "",
      status: "idle",
    });
    expect(
      result.current.sessionOutputs["session-preview"].previewedAt,
    ).toBeUndefined();
  });

  it("keeps peek loading/errors separate from dispatch status and recipients", async () => {
    mocks.state.sessions = [
      {
        id: "session-preview",
        name: "preview host",
        protocol: "ssh",
        status: "connected",
        backendSessionId: "backend-preview",
      },
    ];
    mocks.invoke.mockResolvedValueOnce("\u001b[32mready\u001b[0m\n");
    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(1));

    await act(async () => result.current.peekSession("session-preview"));
    expect(result.current.selectedSessionIds).toEqual(
      new Set(["session-preview"]),
    );
    expect(result.current.previewLoadingSessionIds).toEqual(new Set());
    expect(result.current.previewErrors).toEqual({});
    expect(result.current.sessionOutputs["session-preview"]).toMatchObject({
      output: "ready\n",
      status: "idle",
      previewedAt: expect.any(Date),
    });

    mocks.invoke.mockRejectedValueOnce(new Error("preview unavailable"));
    await act(async () => result.current.peekSession("session-preview"));
    expect(result.current.previewErrors).toEqual({
      "session-preview": "preview unavailable",
    });
    expect(result.current.sessionOutputs["session-preview"].status).toBe(
      "idle",
    );
    expect(
      result.current.sessionOutputs["session-preview"].previewedAt,
    ).toBeUndefined();
    expect(result.current.selectedSessionIds).toEqual(
      new Set(["session-preview"]),
    );
  });
});
