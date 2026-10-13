import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_DATA_STORE_CHANGED_EVENT } from "../../utils/storage/appDataJsonStore";
import {
  MAX_BULK_SCRIPT_BYTES,
  MAX_BULK_SCRIPT_DESCRIPTION_LENGTH,
  MAX_BULK_SCRIPT_NAME_LENGTH,
  bulkScriptsStore,
  isDestructiveBulkScript,
  type BulkScript,
  type BulkScriptLibraryConfig,
  type BulkScriptLibrarySnapshot,
} from "./bulkScriptLibrary";
import { useBulkSSHCommander } from "./useBulkSSHCommander";
import {
  PromptHostUnavailableError,
  type PromptDecision,
  type PromptOptions,
  type PromptRequest,
} from "../../utils/prompts/promptQueue";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  // Stands in for the window's themed prompt. Every confirmation the
  // commander raises must come through here and never through a native box.
  requestPrompt: vi.fn(),
  state: { sessions: [] as Array<Record<string, unknown>> },
  toast: {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
  history: {
    addEntry: vi.fn(),
    navigateUp: vi.fn((): string | null => null),
    navigateDown: vi.fn((): string | null => null),
    // -1 while no arrow-key navigation is in progress, as in the real manager.
    navigationIndex: -1,
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
vi.mock("../../utils/prompts/promptQueue", async () => {
  const actual = await vi.importActual<
    typeof import("../../utils/prompts/promptQueue")
  >("../../utils/prompts/promptQueue");
  return { ...actual, requestPrompt: mocks.requestPrompt };
});

const CONFIRMED: PromptDecision = { confirmed: true, remember: false };
const CANCELLED: PromptDecision = { confirmed: false, remember: false };

const promptCall = (index = 0) =>
  mocks.requestPrompt.mock.calls[index] as [PromptRequest, PromptOptions?];

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const sshSession = (index: number) => ({
  id: `session-${index}`,
  connectionId: `saved-${index}`,
  name: `server ${index}`,
  protocol: "ssh",
  status: "connected",
  backendSessionId: `backend-${index}`,
  hostname: `server-${index}.example`,
});

const sentInputs = () =>
  mocks.invoke.mock.calls
    .filter(([command]) => command === "send_ssh_input")
    .map(([, args]) => args as { sessionId: string; data: string });

const enableTauri = () => {
  (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ =
    {};
};

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
    // An unexpected prompt is answered "no", so it can never make a test pass.
    mocks.requestPrompt.mockReset().mockResolvedValue(CANCELLED);
    mocks.toast.error.mockReset();
    mocks.toast.warning.mockReset();
    mocks.history.addEntry.mockReset();
    mocks.history.navigateUp.mockReset().mockImplementation(() => null);
    mocks.history.navigateDown.mockReset().mockImplementation(() => null);
    mocks.history.navigationIndex = -1;
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
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockReturnValue("yes");
  });

  afterEach(() => {
    const nativeCalls = {
      confirm: vi.mocked(window.confirm).mock.calls.length,
      alert: vi.mocked(window.alert).mock.calls.length,
      prompt: vi.mocked(window.prompt).mock.calls.length,
    };
    // Tidy up first, so that one failure here cannot leak into the next test.
    cleanup();
    vi.restoreAllMocks();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    // The commander never falls back to a native box.
    expect(nativeCalls).toEqual({ confirm: 0, alert: 0, prompt: 0 });
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
      "default-arista-eos-transceiver-service-emc-guarded",
      "default-arista-eos-transceiver-flash-enable-guarded",
      "default-arista-eos-vlan-create-guarded",
      "default-arista-eos-show-vlans",
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
    // "Permanent" policy: moving to the trash is not asked about.
    expect(mocks.requestPrompt).not.toHaveBeenCalled();

    await act(async () => result.current.restoreScript(customScript.id));
    expect(
      result.current.savedScripts.some(
        (script) => script.id === customScript.id,
      ),
    ).toBe(true);
    expect(result.current.trashedScripts).toEqual([]);

    await act(async () => result.current.deleteScript(customScript.id));
    mocks.requestPrompt.mockResolvedValueOnce(CANCELLED);
    const savesBeforeCancel = vi.mocked(bulkScriptsStore.save).mock.calls
      .length;
    await act(async () =>
      result.current.permanentlyDeleteScript(customScript.id),
    );
    expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
    expect(promptCall()[0]).toMatchObject({
      title: 'Permanently delete "Lifecycle script"?',
      confirmLabel: "Delete permanently",
      tone: "danger",
      defaultAction: "cancel",
    });
    expect(vi.mocked(bulkScriptsStore.save)).toHaveBeenCalledTimes(
      savesBeforeCancel,
    );
    expect(result.current.trashedScripts).toHaveLength(1);
    expect(mocks.toast.error).not.toHaveBeenCalled();

    mocks.requestPrompt.mockResolvedValueOnce(CONFIRMED);
    await act(async () =>
      result.current.permanentlyDeleteScript(customScript.id),
    );
    expect(mocks.requestPrompt).toHaveBeenCalledTimes(2);
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

  it("loads a destructive script without asking and confirms once before dispatching", async () => {
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
    enableTauri();
    const { result } = renderHook(() => useBulkSSHCommander(true));
    await waitFor(() => expect(result.current.selectedCount).toBe(1));

    // Loading only fills the editor: nothing asks, nothing is sent.
    act(() => result.current.loadScript(destructiveScript));
    expect(result.current.command).toBe("reboot");
    expect(result.current.loadedScript).toEqual(destructiveScript);
    expect(mocks.requestPrompt).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();

    mocks.requestPrompt.mockResolvedValueOnce(CANCELLED);
    await act(async () => result.current.executeCommand());
    expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
    expect(promptCall()[0]).toMatchObject({
      title: "Send a destructive command to 1 SSH session?",
      tone: "danger",
      defaultAction: "cancel",
      confirmLabel: "Send to 1 session",
      preview: { text: "reboot" },
      targets: {
        items: [
          { id: "session-1", name: "server one", detail: "server-one.example" },
        ],
      },
      facts: ['Script "Restart host"'],
      hint: "Script library, Confirm run: Destructive",
    });
    expect(promptCall()[0].targets?.items).toHaveLength(1);
    expect(promptCall()[1]?.signal).toBeInstanceOf(AbortSignal);
    // A cancel sends nothing, records nothing, reports nothing and keeps the editor.
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.history.addEntry).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    expect(result.current.command).toBe("reboot");
    expect(result.current.isExecuting).toBe(false);

    mocks.requestPrompt.mockResolvedValueOnce(CONFIRMED);
    await act(async () => result.current.executeCommand());
    expect(mocks.requestPrompt).toHaveBeenCalledTimes(2);
    expect(sentInputs()).toEqual([
      { sessionId: "backend-1", data: "reboot\n" },
    ]);
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

  describe("confirmations through the app's own prompt", () => {
    const trashed = (index: number): BulkScript => ({
      ...customScript,
      id: `custom-trashed-${index}`,
      name: `Old script ${index}`,
      deletedAt: "2026-02-01T00:00:00.000Z",
    });

    const mountCommander = async (
      options: {
        sessions?: Array<Record<string, unknown>>;
        active?: BulkScript[];
        trash?: BulkScript[];
        config?: Partial<BulkScriptLibraryConfig>;
      } = {},
    ) => {
      const sessions = options.sessions ?? [];
      mocks.state.sessions = sessions;
      durableSnapshot = {
        ...initialSnapshot(options.active ?? [customScript]),
        trash: options.trash ?? [],
        config: {
          runConfirmation: "destructive-only",
          deleteConfirmation: "permanent-only",
          ...options.config,
        },
      };
      enableTauri();
      const view = renderHook(
        ({ isOpen }: { isOpen: boolean }) => useBulkSSHCommander(isOpen),
        { initialProps: { isOpen: true } },
      );
      await waitFor(() => {
        expect(view.result.current.scriptLibraryLoaded).toBe(true);
        expect(view.result.current.selectedCount).toBe(sessions.length);
      });
      return view;
    };
    type Commander = Awaited<ReturnType<typeof mountCommander>>;

    /** Lets every pending microtask and zero-delay timer run. */
    const flush = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

    /** Starts something that asks, and leaves its prompt open. */
    const startAsking = (start: () => Promise<void>) => {
      const answer = deferred<PromptDecision>();
      mocks.requestPrompt.mockReturnValueOnce(answer.promise);
      let outcome!: Promise<void>;
      act(() => {
        outcome = start();
      });
      return {
        answer: async (decision: PromptDecision) => {
          await act(async () => {
            answer.resolve(decision);
            await outcome;
          });
        },
      };
    };

    const startRun = (view: Commander) =>
      startAsking(() => view.result.current.executeCommand());

    const trashIds = (view: Commander) =>
      view.result.current.trashedScripts.map((script) => script.id);

    describe("sending a command", () => {
      it.each([
        ["never", "uptime", false],
        ["never", "reboot", false],
        ["destructive-only", "uptime", false],
        ["destructive-only", "reboot", true],
        ["always", "uptime", true],
        ["always", "reboot", true],
      ] as const)(
        'with "Confirm run" %s, sending "%s" asks: %s',
        async (runConfirmation, typed, asks) => {
          const view = await mountCommander({
            sessions: [sshSession(1), sshSession(2)],
            config: { runConfirmation },
          });
          act(() => view.result.current.setCommand(typed));
          mocks.requestPrompt.mockResolvedValue(CONFIRMED);

          await act(async () => view.result.current.executeCommand());

          expect(mocks.requestPrompt).toHaveBeenCalledTimes(asks ? 1 : 0);
          expect(sentInputs()).toEqual([
            { sessionId: "backend-1", data: `${typed}\n` },
            { sessionId: "backend-2", data: `${typed}\n` },
          ]);
        },
      );

      it("opens on the affirmative button for an ordinary command and on Cancel for a destructive one", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2)],
          config: { runConfirmation: "always" },
        });

        act(() => view.result.current.setCommand("uptime"));
        await act(async () => view.result.current.executeCommand());
        expect(promptCall(0)[0]).toMatchObject({
          title: "Send this command to 2 SSH sessions?",
          confirmLabel: "Send to 2 sessions",
          // The commander states the focus itself; it does not lean on a default.
          defaultAction: "confirm",
          preview: { text: "uptime" },
          targets: {
            items: [
              { id: "session-1", name: "server 1", detail: "server-1.example" },
              { id: "session-2", name: "server 2", detail: "server-2.example" },
            ],
          },
          hint: "Script library, Confirm run: Always",
        });
        expect(promptCall(0)[0].tone).toBeUndefined();

        act(() => view.result.current.setCommand("systemctl restart nginx"));
        await act(async () => view.result.current.executeCommand());
        expect(promptCall(1)[0]).toMatchObject({
          title: "Send a destructive command to 2 SSH sessions?",
          tone: "danger",
          defaultAction: "cancel",
          preview: { text: "systemctl restart nginx" },
        });
        // No checkbox: a bulk send is asked about every time.
        expect(promptCall(0)[0].remember).toBeUndefined();
        expect(promptCall(1)[0].remember).toBeUndefined();
      });

      it("takes the risk from the commander's own classification of what is in the editor", async () => {
        // Flagged destructive by hand; nothing in its text matches a pattern.
        const flagged: BulkScript = {
          ...customScript,
          id: "custom-flagged",
          name: "Rotate keys",
          script: "uname -a",
          risk: "destructive",
        };
        const view = await mountCommander({
          sessions: [sshSession(1)],
          active: [flagged],
        });

        act(() => view.result.current.setCommand("uname -a"));
        mocks.requestPrompt.mockResolvedValue(CANCELLED);
        await act(async () => view.result.current.executeCommand());
        expect(mocks.requestPrompt).not.toHaveBeenCalled();
        expect(sentInputs()).toHaveLength(1);
        mocks.invoke.mockClear();

        act(() => view.result.current.loadScript(flagged));
        await act(async () => view.result.current.executeCommand());
        expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
        expect(promptCall()[0]).toMatchObject({
          tone: "danger",
          defaultAction: "cancel",
          facts: ['Script "Rotate keys"'],
        });
        expect(sentInputs()).toEqual([]);
      });

      describe("a loaded script that is flagged destructive", () => {
        // Flagged by hand: nothing in its text matches a destructive pattern.
        const flagged: BulkScript = {
          ...customScript,
          id: "custom-flagged",
          name: "Rotate keys",
          script: "uname -a",
          risk: "destructive",
        };

        const mountWith = (config?: Partial<BulkScriptLibraryConfig>) =>
          mountCommander({
            sessions: [sshSession(1)],
            active: [flagged, customScript, destructiveScript],
            config,
          });

        const edit = (view: Commander, text: string) =>
          act(() => view.result.current.setCommand(text));

        /** One character at a time, as typing does. */
        const type = (view: Commander, text: string) => {
          for (let length = 1; length <= text.length; length += 1)
            edit(view, text.slice(0, length));
        };

        /** Backspace until nothing is left. */
        const erase = (view: Commander, text: string) => {
          for (let length = text.length - 1; length >= 0; length -= 1)
            edit(view, text.slice(0, length));
        };

        const press = (view: Commander, key: "ArrowUp" | "ArrowDown") =>
          act(() =>
            view.result.current.handleKeyDown({
              key,
              ctrlKey: false,
              metaKey: false,
              shiftKey: false,
              preventDefault: () => {},
            } as unknown as ReactKeyboardEvent),
          );

        const send = (view: Commander) =>
          act(async () => view.result.current.executeCommand());

        const sentTo1 = (text: string) => [
          { sessionId: "backend-1", data: `${text}\n` },
        ];

        it.each([
          ["at the end", "uname -a | sort"],
          ["at the start", "LANG=C uname -a"],
          ["in the middle", "uname -sr -a"],
          // What typing over a selection does, and all the history panel's
          // "select" can do: it calls setCommand like a keystroke.
          ["wholly, in one step", "hostname"],
        ])(
          "still asks, as for the script itself, when its text was edited %s",
          async (_where, edited) => {
            expect(isDestructiveBulkScript(edited)).toBe(false);
            const view = await mountWith();
            act(() => view.result.current.loadScript(flagged));
            edit(view, edited);
            expect(view.result.current.loadedScript).toEqual(flagged);

            await send(view);
            expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
            expect(promptCall()[0]).toMatchObject({
              title: "Send a destructive command to 1 SSH session?",
              tone: "danger",
              defaultAction: "cancel",
              preview: { text: edited },
              facts: ['Script "Rotate keys (edited)"'],
            });
            expect(sentInputs()).toEqual([]);

            mocks.requestPrompt.mockResolvedValueOnce(CONFIRMED);
            await send(view);
            expect(mocks.requestPrompt).toHaveBeenCalledTimes(2);
            expect(sentInputs()).toEqual(sentTo1(edited));
          },
        );

        it.each([
          ["always", true],
          ["destructive-only", true],
          ["never", false],
        ] as const)(
          'with "Confirm run" %s, sending the edited script asks: %s',
          async (runConfirmation, asks) => {
            const view = await mountWith({ runConfirmation });
            act(() => view.result.current.loadScript(flagged));
            edit(view, "uname -r");
            mocks.requestPrompt.mockResolvedValue(CONFIRMED);

            await send(view);

            expect(mocks.requestPrompt).toHaveBeenCalledTimes(asks ? 1 : 0);
            if (asks)
              expect(promptCall()[0]).toMatchObject({
                tone: "danger",
                defaultAction: "cancel",
              });
            expect(sentInputs()).toEqual(sentTo1("uname -r"));
          },
        );

        it("sent unedited, asks exactly once and names the script without a note", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(flagged));
          mocks.requestPrompt.mockResolvedValueOnce(CONFIRMED);

          await send(view);

          expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
          expect(promptCall()[0]).toMatchObject({
            tone: "danger",
            defaultAction: "cancel",
            preview: { text: "uname -a" },
            facts: ['Script "Rotate keys"'],
          });
          expect(sentInputs()).toEqual(sentTo1("uname -a"));
        });

        it.each([
          ["cleared in one step", (view: Commander) => edit(view, "")],
          [
            "cleared down to blank space",
            (view: Commander) => edit(view, "  \n"),
          ],
          // Leaves "uname -", "uname", … "un", "u" behind as texts the editor held.
          [
            "erased one character at a time",
            (view: Commander) => erase(view, "uname -a"),
          ],
        ])(
          "does not ask about a harmless command typed after the editor was %s",
          async (_how, clear) => {
            expect(isDestructiveBulkScript("unzip -l a.zip")).toBe(false);
            const view = await mountWith();
            act(() => view.result.current.loadScript(flagged));
            clear(view);
            expect(view.result.current.loadedScript).toBeNull();

            edit(view, "");
            type(view, "unzip -l a.zip");
            expect(view.result.current.loadedScript).toBeNull();
            await send(view);

            expect(mocks.requestPrompt).not.toHaveBeenCalled();
            expect(sentInputs()).toEqual(sentTo1("unzip -l a.zip"));
          },
        );

        it.each([
          ["the text it held, as an undo gives it back", "uname -r"],
          ["the script's own text, as a paste gives it back", "uname -a"],
        ])(
          "asks again when the emptied editor gets back %s",
          async (_what, back) => {
            const view = await mountWith();
            act(() => view.result.current.loadScript(flagged));
            edit(view, "uname -r");
            edit(view, "");
            expect(view.result.current.loadedScript).toBeNull();

            edit(view, back);
            expect(view.result.current.loadedScript).toEqual(flagged);
            await send(view);

            expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
            expect(promptCall()[0]).toMatchObject({
              tone: "danger",
              defaultAction: "cancel",
              preview: { text: back },
            });
            expect(sentInputs()).toEqual([]);
          },
        );

        describe("when one of its texts comes back", () => {
          // Hand-flagged, eleven characters, nothing a pattern matches.
          const rotate: BulkScript = {
            ...flagged,
            id: "custom-rotate",
            name: "Rotate now",
            script: "rotate-keys",
          };

          const mountFor = (script: BulkScript) =>
            mountCommander({ sessions: [sshSession(1)], active: [script] });

          const expectAsked = async (view: Commander, text: string) => {
            expect(view.result.current.loadedScript).not.toBeNull();
            await send(view);
            expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
            expect(promptCall()[0]).toMatchObject({
              tone: "danger",
              defaultAction: "cancel",
              preview: { text },
            });
            expect(sentInputs()).toEqual([]);
          };

          const expectNotAsked = async (view: Commander, text: string) => {
            expect(view.result.current.loadedScript).toBeNull();
            await send(view);
            expect(mocks.requestPrompt).not.toHaveBeenCalled();
            expect(sentInputs()).toEqual(sentTo1(text));
          };

          // Ten blanks is the case that got through: the script is one
          // character longer than what the editor held just before the undo.
          it.each([1, 3, 9, 10, 11, 12])(
            "asks again when %i blank(s) typed over the whole script are undone",
            async (blanks) => {
              expect(isDestructiveBulkScript("rotate-keys")).toBe(false);
              const view = await mountFor(rotate);
              act(() => view.result.current.loadScript(rotate));
              type(view, " ".repeat(blanks));
              expect(view.result.current.loadedScript).toBeNull();

              edit(view, "rotate-keys");

              await expectAsked(view, "rotate-keys");
            },
          );

          it("asks again for a two-character script after select all, Enter and an undo", async () => {
            const short: BulkScript = { ...rotate, script: "rk" };
            const view = await mountFor(short);
            act(() => view.result.current.loadScript(short));
            edit(view, "\n");
            expect(view.result.current.loadedScript).toBeNull();

            edit(view, "rk");

            await expectAsked(view, "rk");
          });

          it("asks again when the script is pasted over a history entry that is one character shorter", async () => {
            const view = await mountFor(rotate);
            act(() => view.result.current.loadScript(rotate));
            mocks.history.navigateUp.mockReturnValueOnce("uptime -pp");
            press(view, "ArrowUp");
            expect(view.result.current.command).toBe("uptime -pp");
            expect(view.result.current.loadedScript).toBeNull();

            edit(view, "rotate-keys");

            await expectAsked(view, "rotate-keys");
          });

          it.each([
            ["one blank", " "],
            ["three blanks, one unit short of it", "   "],
            ["another character of one code point", "x"],
          ])(
            "asks again for a script of two emoji undone over %s",
            async (_what, typedOver) => {
              // Two code points, four UTF-16 units.
              const rockets: BulkScript = {
                ...rotate,
                script: "\u{1F680}\u{1F680}",
              };
              const view = await mountFor(rockets);
              act(() => view.result.current.loadScript(rockets));
              edit(view, " ");
              edit(view, typedOver);
              expect(view.result.current.loadedScript).toBeNull();

              edit(view, rockets.script);

              await expectAsked(view, rockets.script);
            },
          );

          it("asks again when a selection is replaced by one character and the result is a text it held", async () => {
            const view = await mountFor(rotate);
            act(() => view.result.current.loadScript(rotate));
            edit(view, "");
            // Unrelated texts first: neither was in the editor with the script.
            edit(view, "rotate-keyzz");
            edit(view, "rotate-keys");
            expect(view.result.current.loadedScript).toEqual(rotate);
            edit(view, "");
            edit(view, "rotate-keyz");
            edit(view, "rotate-keys");

            await expectAsked(view, "rotate-keys");
          });

          it("asks again when a paste completes the script from a typed beginning", async () => {
            const view = await mountFor(rotate);
            act(() => view.result.current.loadScript(rotate));
            edit(view, "");
            type(view, "ro");
            expect(view.result.current.loadedScript).toBeNull();

            edit(view, "rotate-keys");

            await expectAsked(view, "rotate-keys");
          });

          it("asks again when what comes back is more than any typed character, in one piece", async () => {
            // An "e" under seventy accents: one character to a reader.
            const heavy = `e${"\u{301}".repeat(70)}`;
            const marked: BulkScript = { ...rotate, script: `x${heavy}` };
            const view = await mountFor(marked);
            act(() => view.result.current.loadScript(marked));
            edit(view, "x");
            edit(view, "");
            type(view, "x");
            expect(view.result.current.loadedScript).toBeNull();

            edit(view, marked.script);

            await expectAsked(view, marked.script);
          });

          describe("when the text area says how the text changed", () => {
            /** A change as the editor reports it: its input event, then the text. */
            const change = (view: Commander, text: string, inputType: string) =>
              act(() => {
                view.result.current.noteEditorInput({
                  nativeEvent: new InputEvent("input", { inputType }),
                });
                view.result.current.setCommand(text);
              });

            const oneKey: BulkScript = { ...rotate, script: "k" };

            it.each([
              "historyUndo",
              "historyRedo",
              "insertFromPaste",
              "insertFromDrop",
            ])(
              "asks again for a one-character script that comes back by %s",
              async (inputType) => {
                const view = await mountFor(oneKey);
                act(() => view.result.current.loadScript(oneKey));
                change(view, "", "deleteContentBackward");
                expect(view.result.current.loadedScript).toBeNull();

                change(view, "k", inputType);

                await expectAsked(view, "k");
              },
            );

            it("asks again when the script comes back through undos of one character each", async () => {
              const view = await mountFor(rotate);
              act(() => view.result.current.loadScript(rotate));
              erase(view, "rotate-keys");
              expect(view.result.current.loadedScript).toBeNull();

              for (let length = 1; length <= "rotate-keys".length; length += 1)
                change(view, "rotate-keys".slice(0, length), "historyUndo");

              await expectAsked(view, "rotate-keys");
            });

            it.each(["insertText", "insertCompositionText"])(
              "takes %s of one character for a keystroke",
              async (inputType) => {
                const view = await mountFor(oneKey);
                act(() => view.result.current.loadScript(oneKey));
                change(view, "", "deleteContentBackward");

                change(view, "k", inputType);

                await expectNotAsked(view, "k");
              },
            );

            it("reads each report once: a later change that reports nothing is judged by its text", async () => {
              const view = await mountFor(oneKey);
              act(() => view.result.current.loadScript(oneKey));
              change(view, "", "deleteContentBackward");
              act(() =>
                view.result.current.noteEditorInput({
                  nativeEvent: new InputEvent("input", {
                    inputType: "historyUndo",
                  }),
                }),
              );
              edit(view, "x");
              edit(view, "");

              edit(view, "k");

              await expectNotAsked(view, "k");
            });

            it("judges by the text when the event carries no kind", async () => {
              const view = await mountFor(oneKey);
              act(() => view.result.current.loadScript(oneKey));
              change(view, "", "deleteContentBackward");
              act(() =>
                view.result.current.noteEditorInput({
                  nativeEvent: new Event("input"),
                }),
              );
              edit(view, "k");

              await expectNotAsked(view, "k");
            });
          });

          it("does not bring the flag back when the script is typed again, one character at a time", async () => {
            const view = await mountFor(rotate);
            act(() => view.result.current.loadScript(rotate));
            erase(view, "rotate-keys");
            expect(view.result.current.loadedScript).toBeNull();

            type(view, "rotate-keys");

            await expectNotAsked(view, "rotate-keys");
          });

          it.each([
            ["an emoji of one code point", "deploy ", "\u{1F680}"],
            [
              "an emoji of several code points",
              "ship ",
              "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}",
            ],
            ["a flag", "to ", "\u{1F1F5}\u{1F1F9}"],
            ["an accent on its own", "cafe", "\u{301}"],
          ])(
            "takes %s typed at the end for one keystroke",
            async (_what, start, character) => {
              const script: BulkScript = {
                ...rotate,
                script: `${start}${character}`,
              };
              const view = await mountFor(script);
              act(() => view.result.current.loadScript(script));
              // Erased: the character goes in one piece, then the rest.
              edit(view, start);
              erase(view, start);
              expect(view.result.current.loadedScript).toBeNull();

              type(view, start);
              edit(view, script.script);

              await expectNotAsked(view, script.script);
            },
          );

          it("takes an emoji typed in front of one that starts with the same unit for one keystroke", async () => {
            // Both begin with the same high surrogate.
            const script: BulkScript = {
              ...rotate,
              script: "\u{1F601}\u{1F600}",
            };
            const view = await mountFor(script);
            act(() => view.result.current.loadScript(script));
            edit(view, "");
            edit(view, "\u{1F600}");
            expect(view.result.current.loadedScript).toBeNull();

            edit(view, script.script);

            await expectNotAsked(view, script.script);
          });

          it("counts by code point where the runtime cannot tell characters, and asks rather than guess", async () => {
            const intl = Intl as unknown as { Segmenter?: unknown };
            const segmenter = intl.Segmenter;
            const rocket: BulkScript = { ...rotate, script: "go \u{1F680}" };
            const family: BulkScript = {
              ...rotate,
              id: "custom-family",
              script: "ship \u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}",
            };
            const view = await mountFor(rocket);
            intl.Segmenter = undefined;
            try {
              // A letter, and an emoji of one code point, are still keystrokes.
              act(() => view.result.current.loadScript(rocket));
              edit(view, "go ");
              erase(view, "go ");
              type(view, "go ");
              edit(view, rocket.script);
              expect(view.result.current.loadedScript).toBeNull();

              // Five code points at once are not: the flag comes back.
              act(() => view.result.current.loadScript(family));
              edit(view, "ship ");
              erase(view, "ship ");
              type(view, "ship ");
              expect(view.result.current.loadedScript).toBeNull();
              edit(view, family.script);
              expect(view.result.current.loadedScript).toEqual(family);
            } finally {
              intl.Segmenter = segmenter;
            }
          });
        });

        it("does not ask after another, unflagged script was loaded over it, edited or not", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(flagged));
          edit(view, "uname -r");
          act(() => view.result.current.loadScript(customScript));
          expect(view.result.current.loadedScript).toEqual(customScript);

          await send(view);
          expect(mocks.requestPrompt).not.toHaveBeenCalled();
          expect(sentInputs()).toEqual(sentTo1("uname -a"));
          mocks.invoke.mockClear();

          act(() => view.result.current.loadScript(flagged));
          act(() => view.result.current.loadScript(customScript));
          edit(view, "uname -m");
          expect(view.result.current.loadedScript).toEqual(customScript);
          await send(view);
          expect(mocks.requestPrompt).not.toHaveBeenCalled();
          expect(sentInputs()).toEqual(sentTo1("uname -m"));
        });

        it("lets go of the flag when Arrow Up puts a history entry over the script", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(flagged));
          edit(view, "uname -r");

          mocks.history.navigateUp.mockReturnValueOnce("uptime");
          press(view, "ArrowUp");
          // The manager now has a navigation in progress, at its newest entry.
          mocks.history.navigationIndex = 0;
          expect(view.result.current.command).toBe("uptime");
          expect(view.result.current.loadedScript).toBeNull();
          await send(view);

          expect(mocks.requestPrompt).not.toHaveBeenCalled();
          expect(sentInputs()).toEqual(sentTo1("uptime"));
        });

        it("takes the flag back when Arrow Down restores the script's text", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(flagged));
          edit(view, "uname -r");

          mocks.history.navigateUp.mockReturnValueOnce("uptime");
          press(view, "ArrowUp");
          // The manager now has a navigation in progress, at its newest entry.
          mocks.history.navigationIndex = 0;
          // Arrow Down past the newest entry gives back what was in the editor.
          mocks.history.navigateDown.mockReturnValueOnce("uname -r");
          press(view, "ArrowDown");
          expect(view.result.current.command).toBe("uname -r");
          expect(view.result.current.loadedScript).toEqual(flagged);
          await send(view);

          expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
          expect(promptCall()[0]).toMatchObject({
            tone: "danger",
            defaultAction: "cancel",
            facts: ['Script "Rotate keys (edited)"'],
          });
          expect(sentInputs()).toEqual([]);
        });

        it("takes the flag back even when the history entry was edited in between", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(flagged));
          edit(view, "uname -r");

          mocks.history.navigateUp.mockReturnValueOnce("uptime");
          press(view, "ArrowUp");
          // The manager now has a navigation in progress, at its newest entry.
          mocks.history.navigationIndex = 0;
          edit(view, "uptime ");
          edit(view, "uptime -");
          edit(view, "uptime -p");
          expect(view.result.current.loadedScript).toBeNull();
          mocks.history.navigateDown.mockReturnValueOnce("uname -r");
          press(view, "ArrowDown");
          expect(view.result.current.loadedScript).toEqual(flagged);
          await send(view);

          expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
          expect(sentInputs()).toEqual([]);
        });

        it("lets go of the flag when an entry of the in-memory history list is loaded over the script", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(flagged));
          edit(view, "uname -r");

          act(() =>
            view.result.current.loadHistoryCommand({
              id: "1",
              command: "uptime",
              timestamp: new Date(),
              sessionIds: [],
              results: {},
            }),
          );
          expect(view.result.current.loadedScript).toBeNull();
          await send(view);

          expect(mocks.requestPrompt).not.toHaveBeenCalled();
          expect(sentInputs()).toEqual(sentTo1("uptime"));
        });

        it("is forgotten once the send has completed", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(flagged));
          edit(view, "uname -r");
          mocks.requestPrompt.mockResolvedValueOnce(CONFIRMED);
          await send(view);
          expect(sentInputs()).toEqual(sentTo1("uname -r"));
          expect(view.result.current.command).toBe("");
          expect(view.result.current.loadedScript).toBeNull();
          mocks.requestPrompt.mockClear();
          mocks.invoke.mockClear();

          // The same text again, in one step: nothing remembers the script now.
          edit(view, "uname -r");
          expect(view.result.current.loadedScript).toBeNull();
          await send(view);
          expect(mocks.requestPrompt).not.toHaveBeenCalled();
          expect(sentInputs()).toEqual(sentTo1("uname -r"));
        });

        it("stays after a cancelled prompt", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(flagged));
          edit(view, "uname -r");
          await send(view);
          expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);

          edit(view, "uname -rv");
          await send(view);
          expect(mocks.requestPrompt).toHaveBeenCalledTimes(2);
          expect(promptCall(1)[0]).toMatchObject({
            tone: "danger",
            defaultAction: "cancel",
            preview: { text: "uname -rv" },
          });
          expect(sentInputs()).toEqual([]);
        });

        it("keeps asking about a script that is destructive by its text when that part is edited out", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(destructiveScript));
          edit(view, "uptime");

          await send(view);

          expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
          expect(promptCall()[0]).toMatchObject({
            tone: "danger",
            defaultAction: "cancel",
            preview: { text: "uptime" },
            facts: ['Script "Restart host (edited)"'],
          });
        });

        it("treats an edited script that is not flagged as typed text", async () => {
          const view = await mountWith({ runConfirmation: "always" });
          act(() => view.result.current.loadScript(customScript));
          edit(view, "uname -r");

          await send(view);

          expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
          expect(promptCall()[0]).toMatchObject({
            title: "Send this command to 1 SSH session?",
            defaultAction: "confirm",
          });
          expect(promptCall()[0].tone).toBeUndefined();
          expect(promptCall()[0].facts).toBeUndefined();
        });

        it("keeps the note on the chip of a script with a very long name", async () => {
          const view = await mountWith();
          act(() =>
            view.result.current.loadScript({
              ...flagged,
              name: "n".repeat(150),
            }),
          );
          edit(view, "uname -r");

          await send(view);

          const chip = promptCall()[0].facts?.[0] ?? "";
          expect(chip.startsWith('Script "nnnn')).toBe(true);
          expect(chip.endsWith(' (edited)"')).toBe(true);
          expect(chip.length).toBeLessThanOrEqual('Script ""'.length + 80);
        });

        it("remembers the script's own text and its latest edits, however many there were", async () => {
          const view = await mountWith();
          act(() => view.result.current.loadScript(flagged));
          act(() => {
            for (let index = 0; index < 6_000; index += 1)
              view.result.current.setCommand(`uname -a # ${index}`);
          });

          edit(view, "");
          edit(view, "uname -a # 5999");
          expect(view.result.current.loadedScript).toEqual(flagged);
          edit(view, "");
          edit(view, "uname -a");
          expect(view.result.current.loadedScript).toEqual(flagged);
          // The memory is bounded: the oldest edits are the ones it gives up.
          edit(view, "");
          edit(view, "uname -a # 0");
          expect(view.result.current.loadedScript).toBeNull();
        });
      });

      it("sends nothing and shows no progress until the prompt is answered", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2)],
        });
        act(() => view.result.current.setCommand("reboot"));

        const prompt = startRun(view);
        await flush();
        expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
        expect(sentInputs()).toEqual([]);
        expect(view.result.current.isExecuting).toBe(false);
        expect(mocks.history.addEntry).not.toHaveBeenCalled();

        await prompt.answer(CONFIRMED);
        expect(sentInputs()).toHaveLength(2);
        expect(mocks.history.addEntry).toHaveBeenCalledTimes(1);
      });

      it("sends exactly the command that was shown, to exactly the sessions that were listed", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2), sshSession(3)],
          config: { runConfirmation: "always" },
        });
        act(() => view.result.current.toggleSessionSelection("session-2"));
        act(() => view.result.current.setCommand("  df -h /var  \n"));
        mocks.requestPrompt.mockResolvedValueOnce(CONFIRMED);

        await act(async () => view.result.current.executeCommand());

        const shown = promptCall()[0];
        expect(shown.preview?.text).toBe("df -h /var");
        expect(shown.targets?.items.map((item) => item.id)).toEqual([
          "session-1",
          "session-3",
        ]);
        expect(sentInputs()).toEqual([
          { sessionId: "backend-1", data: `${shown.preview?.text}\n` },
          { sessionId: "backend-3", data: `${shown.preview?.text}\n` },
        ]);
      });

      it("names every selected session to the prompt, however many there are", async () => {
        const sessions = Array.from({ length: 620 }, (_, index) =>
          sshSession(index + 1),
        );
        const view = await mountCommander({ sessions });
        act(() => view.result.current.setCommand("reboot"));
        mocks.requestPrompt.mockResolvedValueOnce(CONFIRMED);

        await act(async () => view.result.current.executeCommand());

        const shown = promptCall()[0];
        expect(shown.title).toBe(
          "Send a destructive command to 620 SSH sessions?",
        );
        expect(shown.targets?.items).toHaveLength(620);
        expect(shown.targets?.items[619]).toEqual({
          id: "session-620",
          name: "server 620",
          detail: "server-620.example",
        });
        expect(sentInputs().map((sent) => sent.sessionId)).toEqual(
          sessions.map((session) => session.backendSessionId),
        );
      });

      it("raises one prompt however often Send is triggered while it is open", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2)],
        });
        act(() => view.result.current.setCommand("reboot"));

        const prompt = startRun(view);
        await act(async () => view.result.current.executeCommand());
        act(() =>
          view.result.current.handleKeyDown({
            key: "Enter",
            ctrlKey: true,
            metaKey: false,
            shiftKey: false,
            preventDefault: () => {},
          } as unknown as ReactKeyboardEvent),
        );
        await flush();
        expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);

        await prompt.answer(CONFIRMED);
        expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
        expect(sentInputs()).toEqual([
          { sessionId: "backend-1", data: "reboot\n" },
          { sessionId: "backend-2", data: "reboot\n" },
        ]);
      });

      it("does not start a second run from a stale callback while the first is being dispatched", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1)],
          config: { runConfirmation: "always" },
        });
        act(() => view.result.current.setCommand("uptime"));
        mocks.requestPrompt.mockResolvedValue(CONFIRMED);
        const dispatch = deferred<void>();
        mocks.invoke.mockImplementation(() => dispatch.promise);
        // The callback of the render in which Send was pressed: its own
        // `isExecuting` stays false however far the run has got.
        const stale = view.result.current.executeCommand;

        let first!: Promise<void>;
        act(() => {
          first = stale();
        });
        await flush();
        expect(sentInputs()).toHaveLength(1);

        let second!: Promise<void>;
        act(() => {
          second = stale();
        });
        await flush();
        expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
        expect(sentInputs()).toHaveLength(1);

        await act(async () => {
          dispatch.resolve();
          await Promise.all([first, second]);
        });
        expect(view.result.current.isExecuting).toBe(false);
      });

      it.each([
        [
          "a recipient is deselected",
          (view: Commander) =>
            act(() => view.result.current.toggleSessionSelection("session-2")),
        ],
        [
          "a recipient is added",
          (view: Commander) =>
            act(() => view.result.current.toggleSessionSelection("session-3")),
        ],
        [
          "a recipient disconnects",
          (view: Commander) => {
            mocks.state.sessions = [sshSession(1), sshSession(3)];
            view.rerender({ isOpen: true });
          },
        ],
        [
          "a recipient reconnects as another backend session",
          (view: Commander) => {
            mocks.state.sessions = [
              sshSession(1),
              { ...sshSession(2), backendSessionId: "backend-2b" },
              sshSession(3),
            ];
            view.rerender({ isOpen: true });
          },
        ],
      ] as const)(
        "sends nothing and says so when %s while the prompt is open",
        async (_what, change) => {
          const view = await mountCommander({
            sessions: [sshSession(1), sshSession(2), sshSession(3)],
          });
          act(() => view.result.current.toggleSessionSelection("session-3"));
          act(() => view.result.current.setCommand("reboot"));

          const prompt = startRun(view);
          expect(promptCall()[0].targets?.items.map((item) => item.id)).toEqual(
            ["session-1", "session-2"],
          );
          change(view);
          await prompt.answer(CONFIRMED);

          expect(sentInputs()).toEqual([]);
          expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
          expect(mocks.toast.warning).toHaveBeenCalledWith(
            "The selected sessions changed while you were reviewing. Nothing was sent.",
          );
          expect(mocks.history.addEntry).not.toHaveBeenCalled();
          expect(view.result.current.isExecuting).toBe(false);
          expect(view.result.current.command).toBe("reboot");
        },
      );

      describe("sessions that share a display name", () => {
        const namesake = (index: number) => ({
          ...sshSession(index),
          name: "web",
          hostname: "10.0.0.5",
        });

        it("lists each of them under its own id and refuses the send when one is swapped for a third", async () => {
          const view = await mountCommander({
            sessions: [namesake(1), namesake(2), namesake(3)],
          });
          act(() => view.result.current.toggleSessionSelection("session-3"));
          act(() => view.result.current.setCommand("reboot"));

          const prompt = startRun(view);
          expect(promptCall()[0].targets?.items).toEqual([
            { id: "session-1", name: "web", detail: "10.0.0.5" },
            { id: "session-2", name: "web", detail: "10.0.0.5" },
          ]);
          // The same count, names and hosts; another session.
          act(() => view.result.current.toggleSessionSelection("session-2"));
          act(() => view.result.current.toggleSessionSelection("session-3"));
          expect(view.result.current.selectedCount).toBe(2);
          await prompt.answer(CONFIRMED);

          expect(sentInputs()).toEqual([]);
          expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
          expect(mocks.toast.warning).toHaveBeenCalledWith(
            "The selected sessions changed while you were reviewing. Nothing was sent.",
          );
          expect(mocks.history.addEntry).not.toHaveBeenCalled();
        });

        it("refuses the send when the one selected session is swapped for its namesake", async () => {
          const view = await mountCommander({
            sessions: [namesake(1), namesake(2)],
          });
          act(() => view.result.current.toggleSessionSelection("session-2"));
          act(() => view.result.current.setCommand("reboot"));

          const prompt = startRun(view);
          expect(promptCall()[0].targets?.items).toEqual([
            { id: "session-1", name: "web", detail: "10.0.0.5" },
          ]);
          act(() => view.result.current.toggleSessionSelection("session-1"));
          act(() => view.result.current.toggleSessionSelection("session-2"));
          await prompt.answer(CONFIRMED);

          expect(sentInputs()).toEqual([]);
          expect(mocks.toast.warning).toHaveBeenCalledWith(
            "The selected sessions changed while you were reviewing. Nothing was sent.",
          );
        });

        it("sends to each of them, by its own backend session, when nothing changed", async () => {
          const view = await mountCommander({
            sessions: [namesake(1), namesake(2)],
          });
          act(() => view.result.current.setCommand("reboot"));

          const prompt = startRun(view);
          await prompt.answer(CONFIRMED);

          expect(mocks.toast.warning).not.toHaveBeenCalled();
          expect(sentInputs()).toEqual([
            { sessionId: "backend-1", data: "reboot\n" },
            { sessionId: "backend-2", data: "reboot\n" },
          ]);
        });

        it("never joins another prompt: the request carries no dedupe key", async () => {
          const view = await mountCommander({
            sessions: [namesake(1), namesake(2)],
          });
          act(() => view.result.current.setCommand("reboot"));

          await act(async () => view.result.current.executeCommand());

          expect(promptCall()[0].dedupeKey).toBeUndefined();
        });
      });

      it("sends nothing when a recipient that is still connecting is swapped for another one", async () => {
        // Neither has a backend session yet: only the session id tells them apart.
        const connecting = (index: number) => ({
          ...sshSession(index),
          status: "connecting",
          backendSessionId: undefined,
        });
        const view = await mountCommander({
          sessions: [sshSession(1), connecting(2), connecting(3)],
        });
        act(() => view.result.current.toggleSessionSelection("session-3"));
        act(() => view.result.current.setCommand("reboot"));

        const prompt = startRun(view);
        act(() => view.result.current.toggleSessionSelection("session-2"));
        act(() => view.result.current.toggleSessionSelection("session-3"));
        expect(view.result.current.selectedCount).toBe(2);
        await prompt.answer(CONFIRMED);

        expect(sentInputs()).toEqual([]);
        expect(mocks.toast.warning).toHaveBeenCalledWith(
          "The selected sessions changed while you were reviewing. Nothing was sent.",
        );
      });

      it("still sends when only something that was not reviewed changed", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2), sshSession(3)],
        });
        act(() => view.result.current.toggleSessionSelection("session-3"));
        act(() => view.result.current.setCommand("reboot"));

        const prompt = startRun(view);
        // The unselected session goes away and the others swap places.
        mocks.state.sessions = [sshSession(2), sshSession(1)];
        view.rerender({ isOpen: true });
        await prompt.answer(CONFIRMED);

        expect(mocks.toast.warning).not.toHaveBeenCalled();
        expect(sentInputs()).toEqual([
          { sessionId: "backend-1", data: "reboot\n" },
          { sessionId: "backend-2", data: "reboot\n" },
        ]);
      });

      it("sends nothing and says so when the editor changed while the prompt is open", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2)],
        });
        act(() => view.result.current.setCommand("reboot"));

        const prompt = startRun(view);
        act(() => view.result.current.setCommand("reboot --force"));
        await prompt.answer(CONFIRMED);

        expect(sentInputs()).toEqual([]);
        expect(mocks.toast.warning).toHaveBeenCalledTimes(1);
        expect(mocks.toast.warning).toHaveBeenCalledWith(
          "The command changed while you were reviewing. Nothing was sent.",
        );
        expect(mocks.history.addEntry).not.toHaveBeenCalled();
        expect(view.result.current.command).toBe("reboot --force");
      });

      it("sends nothing and says so when the window cannot show the prompt", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2)],
        });
        act(() => view.result.current.setCommand("reboot"));
        mocks.requestPrompt.mockRejectedValueOnce(
          new PromptHostUnavailableError(),
        );

        await act(async () => view.result.current.executeCommand());

        expect(sentInputs()).toEqual([]);
        expect(mocks.toast.error).toHaveBeenCalledTimes(1);
        expect(mocks.toast.error).toHaveBeenCalledWith(
          "The confirmation could not be shown. Nothing was sent.",
        );
        expect(mocks.history.addEntry).not.toHaveBeenCalled();
        expect(view.result.current.isExecuting).toBe(false);
        expect(view.result.current.command).toBe("reboot");

        // The failed prompt is not left "open": the next Send asks again.
        mocks.requestPrompt.mockResolvedValueOnce(CONFIRMED);
        await act(async () => view.result.current.executeCommand());
        expect(mocks.requestPrompt).toHaveBeenCalledTimes(2);
        expect(sentInputs()).toHaveLength(2);
      });

      it("aborts its open prompt when the commander unmounts, and sends nothing whatever answer arrives", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2)],
        });
        act(() => view.result.current.setCommand("reboot"));

        const prompt = startRun(view);
        const signal = promptCall()[1]?.signal;
        expect(signal?.aborted).toBe(false);

        view.unmount();
        expect(signal?.aborted).toBe(true);

        await prompt.answer(CONFIRMED);
        expect(sentInputs()).toEqual([]);
        expect(mocks.history.addEntry).not.toHaveBeenCalled();
        expect(mocks.toast.error).not.toHaveBeenCalled();
        expect(mocks.toast.warning).not.toHaveBeenCalled();
      });

      it("aborts its open prompt when the commander is closed", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2)],
        });
        act(() => view.result.current.setCommand("reboot"));

        const prompt = startRun(view);
        const signal = promptCall()[1]?.signal;
        view.rerender({ isOpen: false });
        expect(signal?.aborted).toBe(true);

        await prompt.answer(CONFIRMED);
        expect(sentInputs()).toEqual([]);
        expect(mocks.toast.error).not.toHaveBeenCalled();
        expect(mocks.toast.warning).not.toHaveBeenCalled();
      });

      it("reports nothing when a prompt fails after the commander has gone", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1), sshSession(2)],
        });
        act(() => view.result.current.setCommand("reboot"));
        const failure = deferred<PromptDecision>();
        mocks.requestPrompt.mockReturnValueOnce(failure.promise);
        let run!: Promise<void>;
        act(() => {
          run = view.result.current.executeCommand();
        });

        view.unmount();
        await act(async () => {
          failure.reject(new PromptHostUnavailableError());
          await run;
        });

        expect(sentInputs()).toEqual([]);
        expect(mocks.toast.error).not.toHaveBeenCalled();
      });
    });

    describe("the arrow keys in the editor", () => {
      const severalLines = "echo one\necho two";

      /** Presses the key; the returned spy tells whether the caret was kept from moving. */
      const press = (
        view: Commander,
        key: "ArrowUp" | "ArrowDown",
        shiftKey = false,
      ) => {
        const preventDefault = vi.fn();
        act(() =>
          view.result.current.handleKeyDown({
            key,
            ctrlKey: false,
            metaKey: false,
            shiftKey,
            preventDefault,
          } as unknown as ReactKeyboardEvent),
        );
        return preventDefault;
      };

      const edit = (view: Commander, text: string) =>
        act(() => view.result.current.setCommand(text));

      it("Arrow Down leaves the text alone when no history navigation is in progress", async () => {
        const view = await mountCommander({ sessions: [sshSession(1)] });
        // What the real manager hands back then: its empty draft.
        mocks.history.navigateDown.mockImplementation(() => "");

        for (const text of ["uptime", severalLines, ""]) {
          edit(view, text);
          const caretKept = press(view, "ArrowDown");
          expect(view.result.current.command).toBe(text);
          expect(caretKept).not.toHaveBeenCalled();
        }
        expect(mocks.history.navigateDown).not.toHaveBeenCalled();
      });

      it("leaves a text of several lines alone and lets the caret move", async () => {
        const view = await mountCommander({ sessions: [sshSession(1)] });
        mocks.history.navigateUp.mockImplementation(() => "uptime");
        mocks.history.navigateDown.mockImplementation(() => "df -h");
        // Even with a navigation on the manager's record.
        mocks.history.navigationIndex = 0;

        // A lone carriage return is a line break in a text area as well.
        for (const text of [severalLines, "ls\n", "one\r\ntwo", "one\rtwo"]) {
          edit(view, text);
          for (const key of ["ArrowUp", "ArrowDown"] as const) {
            const caretKept = press(view, key);
            expect(view.result.current.command).toBe(text);
            expect(caretKept).not.toHaveBeenCalled();
          }
        }
        expect(mocks.history.navigateUp).not.toHaveBeenCalled();
        expect(mocks.history.navigateDown).not.toHaveBeenCalled();
      });

      it("leaves a loaded script of several lines alone, with its flag", async () => {
        const script: BulkScript = {
          ...customScript,
          id: "custom-two-steps",
          name: "Two steps",
          script: severalLines,
          risk: "destructive",
        };
        const view = await mountCommander({
          sessions: [sshSession(1)],
          active: [script],
        });
        mocks.history.navigateUp.mockImplementation(() => "uptime");
        mocks.history.navigateDown.mockImplementation(() => "");
        act(() => view.result.current.loadScript(script));

        press(view, "ArrowDown");
        press(view, "ArrowUp");
        mocks.history.navigationIndex = 0;
        press(view, "ArrowDown");
        press(view, "ArrowUp");

        expect(view.result.current.command).toBe(severalLines);
        expect(view.result.current.loadedScript).toEqual(script);
        await act(async () => view.result.current.executeCommand());
        expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
        expect(promptCall()[0]).toMatchObject({
          tone: "danger",
          defaultAction: "cancel",
          preview: { text: severalLines },
          facts: ['Script "Two steps"'],
        });
      });

      it("steps into the history from a one-line or an empty editor and gives the draft back", async () => {
        const view = await mountCommander({ sessions: [sshSession(1)] });
        edit(view, "df -h");

        mocks.history.navigateUp.mockReturnValueOnce("uptime");
        const up = press(view, "ArrowUp");
        expect(mocks.history.navigateUp).toHaveBeenCalledWith("df -h");
        expect(up).toHaveBeenCalledTimes(1);
        expect(view.result.current.command).toBe("uptime");

        mocks.history.navigationIndex = 0;
        mocks.history.navigateDown.mockReturnValueOnce("df -h");
        const down = press(view, "ArrowDown");
        expect(down).toHaveBeenCalledTimes(1);
        expect(view.result.current.command).toBe("df -h");

        mocks.history.navigationIndex = -1;
        edit(view, "");
        mocks.history.navigateUp.mockReturnValueOnce("uptime");
        press(view, "ArrowUp");
        expect(mocks.history.navigateUp).toHaveBeenLastCalledWith("");
        expect(view.result.current.command).toBe("uptime");
      });

      it("keeps stepping while the editor shows an entry of several lines that the keys put there", async () => {
        const view = await mountCommander({ sessions: [sshSession(1)] });

        mocks.history.navigateUp.mockReturnValueOnce(severalLines);
        press(view, "ArrowUp");
        mocks.history.navigationIndex = 0;
        expect(view.result.current.command).toBe(severalLines);

        mocks.history.navigateUp.mockReturnValueOnce("older entry");
        const up = press(view, "ArrowUp");
        mocks.history.navigationIndex = 1;
        expect(up).toHaveBeenCalledTimes(1);
        expect(view.result.current.command).toBe("older entry");

        mocks.history.navigateDown.mockReturnValueOnce(severalLines);
        press(view, "ArrowDown");
        mocks.history.navigationIndex = 0;
        expect(view.result.current.command).toBe(severalLines);

        // And out of it again, back to the (empty) draft.
        mocks.history.navigateDown.mockReturnValueOnce("");
        const down = press(view, "ArrowDown");
        mocks.history.navigationIndex = -1;
        expect(down).toHaveBeenCalledTimes(1);
        expect(view.result.current.command).toBe("");
      });

      it("moves the caret instead once that entry was edited", async () => {
        const view = await mountCommander({ sessions: [sshSession(1)] });
        mocks.history.navigateUp.mockReturnValueOnce(severalLines);
        press(view, "ArrowUp");
        mocks.history.navigationIndex = 0;
        mocks.history.navigateUp.mockImplementation(() => "older entry");
        mocks.history.navigateDown.mockImplementation(() => "");
        mocks.history.navigateUp.mockClear();

        edit(view, `${severalLines} # mine`);
        expect(press(view, "ArrowUp")).not.toHaveBeenCalled();
        expect(press(view, "ArrowDown")).not.toHaveBeenCalled();
        expect(view.result.current.command).toBe(`${severalLines} # mine`);

        // Typed back to the same text, it is the user's text now.
        edit(view, severalLines);
        expect(press(view, "ArrowUp")).not.toHaveBeenCalled();
        expect(view.result.current.command).toBe(severalLines);
        expect(mocks.history.navigateUp).not.toHaveBeenCalled();
        expect(mocks.history.navigateDown).not.toHaveBeenCalled();
      });

      it("does not take a loaded script for the entry the keys showed, even with the same text", async () => {
        const script: BulkScript = {
          ...customScript,
          id: "custom-two-steps",
          name: "Two steps",
          script: severalLines,
        };
        const view = await mountCommander({
          sessions: [sshSession(1)],
          active: [script],
        });
        mocks.history.navigateUp.mockReturnValueOnce(severalLines);
        press(view, "ArrowUp");
        mocks.history.navigationIndex = 0;
        mocks.history.navigateUp.mockImplementation(() => "older entry");
        mocks.history.navigateDown.mockImplementation(() => "");

        act(() => view.result.current.loadScript(script));
        expect(press(view, "ArrowUp")).not.toHaveBeenCalled();
        expect(press(view, "ArrowDown")).not.toHaveBeenCalled();

        expect(view.result.current.command).toBe(severalLines);
        expect(view.result.current.loadedScript).toEqual(script);
      });

      it("keeps a one-line loaded script and its flag when Arrow Down is pressed without a navigation", async () => {
        const script: BulkScript = {
          ...customScript,
          id: "custom-flagged",
          name: "Rotate keys",
          script: "uname -a",
          risk: "destructive",
        };
        const view = await mountCommander({
          sessions: [sshSession(1)],
          active: [script],
        });
        mocks.history.navigateDown.mockImplementation(() => "");
        act(() => view.result.current.loadScript(script));

        expect(press(view, "ArrowDown")).not.toHaveBeenCalled();

        expect(view.result.current.command).toBe("uname -a");
        expect(view.result.current.loadedScript).toEqual(script);
      });

      it("never navigates with Shift held, which selects text", async () => {
        const view = await mountCommander({ sessions: [sshSession(1)] });
        mocks.history.navigateUp.mockImplementation(() => "uptime");
        mocks.history.navigateDown.mockImplementation(() => "");
        mocks.history.navigationIndex = 0;
        edit(view, "df -h");

        expect(press(view, "ArrowUp", true)).not.toHaveBeenCalled();
        expect(press(view, "ArrowDown", true)).not.toHaveBeenCalled();

        expect(view.result.current.command).toBe("df -h");
      });
    });

    describe("the script library", () => {
      it.each([
        ["never", false, false],
        ["permanent-only", false, true],
        ["always", true, true],
      ] as const)(
        'with "Confirm delete" %s, a move to the trash asks: %s, a permanent delete asks: %s',
        async (deleteConfirmation, trashAsks, permanentAsks) => {
          const view = await mountCommander({
            trash: [trashed(1), trashed(2)],
            config: { deleteConfirmation },
          });
          mocks.requestPrompt.mockResolvedValue(CONFIRMED);

          await act(async () =>
            view.result.current.deleteScript(customScript.id),
          );
          expect(mocks.requestPrompt).toHaveBeenCalledTimes(trashAsks ? 1 : 0);
          expect(trashIds(view)).toContain(customScript.id);
          mocks.requestPrompt.mockClear();

          await act(async () =>
            view.result.current.permanentlyDeleteScript("custom-trashed-1"),
          );
          expect(mocks.requestPrompt).toHaveBeenCalledTimes(
            permanentAsks ? 1 : 0,
          );
          expect(trashIds(view)).not.toContain("custom-trashed-1");
          mocks.requestPrompt.mockClear();

          await act(async () => view.result.current.emptyScriptTrash());
          expect(mocks.requestPrompt).toHaveBeenCalledTimes(
            permanentAsks ? 1 : 0,
          );
          expect(trashIds(view)).toEqual([]);
        },
      );

      it("opens on the affirmative button for a move to the trash and on Cancel for anything permanent", async () => {
        const view = await mountCommander({
          trash: [trashed(1), trashed(2)],
          config: { deleteConfirmation: "always" },
        });

        await act(async () =>
          view.result.current.deleteScript(customScript.id),
        );
        expect(promptCall(0)[0]).toMatchObject({
          title: 'Move "Lifecycle script" to trash?',
          confirmLabel: "Move to trash",
          defaultAction: "confirm",
        });
        expect(promptCall(0)[0].tone).toBeUndefined();

        await act(async () =>
          view.result.current.permanentlyDeleteScript("custom-trashed-1"),
        );
        expect(promptCall(1)[0]).toMatchObject({
          title: 'Permanently delete "Old script 1"?',
          confirmLabel: "Delete permanently",
          tone: "danger",
          defaultAction: "cancel",
        });

        await act(async () => view.result.current.emptyScriptTrash());
        expect(promptCall(2)[0]).toMatchObject({
          title: "Permanently delete 2 trashed scripts?",
          confirmLabel: "Empty trash",
          tone: "danger",
          defaultAction: "cancel",
        });
        // No checkbox on a delete either.
        for (const index of [0, 1, 2]) {
          expect(promptCall(index)[0].remember).toBeUndefined();
        }
        for (const index of [0, 1, 2]) {
          expect(promptCall(index)[1]?.signal).toBeInstanceOf(AbortSignal);
        }
      });

      it("changes nothing and reports nothing when a delete prompt is cancelled", async () => {
        const view = await mountCommander({
          trash: [trashed(1), trashed(2)],
          config: { deleteConfirmation: "always" },
        });

        await act(async () =>
          view.result.current.deleteScript(customScript.id),
        );
        await act(async () =>
          view.result.current.permanentlyDeleteScript("custom-trashed-1"),
        );
        await act(async () => view.result.current.emptyScriptTrash());

        expect(mocks.requestPrompt).toHaveBeenCalledTimes(3);
        expect(vi.mocked(bulkScriptsStore.save)).not.toHaveBeenCalled();
        expect(trashIds(view)).toEqual([
          "custom-trashed-1",
          "custom-trashed-2",
        ]);
        expect(
          view.result.current.savedScripts.some(
            (script) => script.id === customScript.id,
          ),
        ).toBe(true);
        expect(mocks.toast.error).not.toHaveBeenCalled();
        expect(mocks.toast.warning).not.toHaveBeenCalled();
      });

      it("deletes nothing and says so when the window cannot show the prompt", async () => {
        const view = await mountCommander({
          trash: [trashed(1), trashed(2)],
          config: { deleteConfirmation: "always" },
        });
        mocks.requestPrompt.mockRejectedValue(new PromptHostUnavailableError());

        await act(async () =>
          view.result.current.deleteScript(customScript.id),
        );
        await act(async () =>
          view.result.current.permanentlyDeleteScript("custom-trashed-1"),
        );
        await act(async () => view.result.current.emptyScriptTrash());

        expect(vi.mocked(bulkScriptsStore.save)).not.toHaveBeenCalled();
        expect(trashIds(view)).toEqual([
          "custom-trashed-1",
          "custom-trashed-2",
        ]);
        expect(mocks.toast.error.mock.calls).toEqual([
          ["The confirmation could not be shown. Nothing was deleted."],
          ["The confirmation could not be shown. Nothing was deleted."],
          ["The confirmation could not be shown. Nothing was deleted."],
        ]);
      });

      it("empties only the scripts that were in the trash when the prompt was shown", async () => {
        const view = await mountCommander({ trash: [trashed(1), trashed(2)] });

        const prompt = startAsking(() =>
          view.result.current.emptyScriptTrash(),
        );
        expect(promptCall()[0].title).toBe(
          "Permanently delete 2 trashed scripts?",
        );
        await flush();
        expect(vi.mocked(bulkScriptsStore.save)).not.toHaveBeenCalled();
        // Another window trashes a third script while the prompt is open.
        durableSnapshot = {
          ...durableSnapshot,
          trash: [...durableSnapshot.trash, trashed(3)],
        };
        await prompt.answer(CONFIRMED);

        expect(durableSnapshot.trash.map((script) => script.id)).toEqual([
          "custom-trashed-3",
        ]);
      });

      it("aborts an open delete prompt when the commander unmounts, and deletes nothing", async () => {
        const view = await mountCommander({ trash: [trashed(1)] });

        const prompt = startAsking(() =>
          view.result.current.permanentlyDeleteScript("custom-trashed-1"),
        );
        const signal = promptCall()[1]?.signal;
        expect(signal?.aborted).toBe(false);
        view.unmount();
        expect(signal?.aborted).toBe(true);

        await prompt.answer(CONFIRMED);
        expect(vi.mocked(bulkScriptsStore.save)).not.toHaveBeenCalled();
        expect(durableSnapshot.trash).toHaveLength(1);
      });

      it("keeps to one prompt across sends and deletes", async () => {
        const view = await mountCommander({
          sessions: [sshSession(1)],
          trash: [trashed(1), trashed(2)],
          config: { runConfirmation: "always" },
        });
        act(() => view.result.current.setCommand("uptime"));

        const prompt = startAsking(() =>
          view.result.current.permanentlyDeleteScript("custom-trashed-1"),
        );
        await act(async () => {
          await view.result.current.executeCommand();
          await view.result.current.emptyScriptTrash();
          await view.result.current.permanentlyDeleteScript("custom-trashed-2");
        });
        expect(mocks.requestPrompt).toHaveBeenCalledTimes(1);
        expect(sentInputs()).toEqual([]);
        expect(vi.mocked(bulkScriptsStore.save)).not.toHaveBeenCalled();

        await prompt.answer(CONFIRMED);
        expect(trashIds(view)).toEqual(["custom-trashed-2"]);
        expect(sentInputs()).toEqual([]);
      });
    });
  });
});
