import { webcrypto } from "node:crypto";
import { trustedClick } from "../helpers/trustedClick";
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => invoke,
}));
import React from "react";
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
import { invoke } from "@tauri-apps/api/core";
import { BulkSSHCommander } from "../../src/components/ssh/BulkSSHCommander";
import { PromptHost } from "../../src/components/ui/dialogs/PromptHost";
import { ToastProvider } from "../../src/contexts/ToastContext";
import {
  bulkScriptsStore,
  type BulkScript,
  type BulkScriptLibraryConfig,
  type BulkScriptLibrarySnapshot,
} from "../../src/hooks/ssh/bulkScriptLibrary";
import {
  getSSHCommandHistoryMemorySnapshot,
  resetSSHCommandHistoryMemoryForTests,
} from "../../src/hooks/ssh/useSSHCommandHistory";
import { resetPromptQueueForTests } from "../../src/utils/prompts/promptQueue";

// The Bulk SSH commander with the window's real prompt host and queue: what
// the user sees and what reaches the sessions, from Send to the answer.

const world = vi.hoisted(() => ({
  sessions: [] as Array<Record<string, unknown>>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { sessions: world.sessions, connections: [] },
    dispatch: vi.fn(),
  }),
}));

const sshSession = (index: number) => ({
  id: `session-${index}`,
  connectionId: `saved-ssh-${index}`,
  name: `SSH Server ${index}`,
  protocol: "ssh",
  hostname: `192.168.1.10${index}`,
  status: "connected",
  backendSessionId: `backend-${index}`,
});

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

const trashed = (index: number): BulkScript => ({
  ...customScript,
  id: `custom-trashed-${index}`,
  name: `Old script ${index}`,
  deletedAt: "2026-02-01T00:00:00.000Z",
});

const SELECTION_CHANGED =
  "The selected sessions changed while you were reviewing. Nothing was sent.";

const onClose = vi.fn();

const AppWindow: React.FC<{ commander?: boolean; host?: boolean }> = ({
  commander = true,
  host = true,
}) => (
  <ToastProvider>
    {commander && <BulkSSHCommander isOpen onClose={onClose} />}
    {host && <PromptHost />}
  </ToastProvider>
);

const cloneSnapshot = (
  snapshot: BulkScriptLibrarySnapshot,
): BulkScriptLibrarySnapshot => JSON.parse(JSON.stringify(snapshot));

const sends = () =>
  vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "send_ssh_input")
    .map(([, args]) => args as { sessionId: string; data: string });

const editor = () =>
  screen.getByPlaceholderText(/Enter command/i) as HTMLTextAreaElement;
const sendButton = () =>
  screen.getByText("Send").closest("button") as HTMLButtonElement;
const prompts = () => screen.queryAllByTestId("app-prompt");
const confirmButton = () => screen.getByTestId("app-prompt-confirm");
const cancelButton = () => screen.getByTestId("app-prompt-cancel");
const toasts = () => Array.from(document.querySelectorAll(".toast-item"));

const nativeDialogCalls = () => ({
  confirm: vi.mocked(window.confirm).mock.calls.length,
  alert: vi.mocked(window.alert).mock.calls.length,
  prompt: vi.mocked(window.prompt).mock.calls.length,
});

const typeCommand = (value: string) =>
  fireEvent.change(editor(), { target: { value } });

/** A real click starts on the button, so the button is what regains focus. */
const pressSend = () => {
  sendButton().focus();
  fireEvent.click(sendButton());
};

/**
 * A mouse click on the dialog. A click made with Enter or Space reports
 * `detail: 0`, which the dialog may refuse while it has only just opened; a
 * mouse reports 1.
 */
const clickWithMouse = (element: Element) =>
  fireEvent.click(element, { detail: 1 });

describe("Bulk SSH commander prompts", () => {
  let durable: BulkScriptLibrarySnapshot;

  const openCommander = async (
    options: {
      sessions?: Array<Record<string, unknown>>;
      active?: BulkScript[];
      trash?: BulkScript[];
      config?: Partial<BulkScriptLibraryConfig>;
      host?: boolean;
    } = {},
  ) => {
    world.sessions = options.sessions ?? [sshSession(1), sshSession(2)];
    durable = {
      version: 2,
      active: options.active ?? [customScript],
      trash: options.trash ?? [],
      config: {
        runConfirmation: "destructive-only",
        deleteConfirmation: "permanent-only",
        ...options.config,
      },
    };
    const view = render(<AppWindow host={options.host} />);
    // The policies come with the library: wait until it has been applied.
    await waitFor(() =>
      expect(vi.mocked(bulkScriptsStore.load).mock.results[0]?.type).toBe(
        "return",
      ),
    );
    await act(async () => {
      await vi.mocked(bulkScriptsStore.load).mock.results[0].value;
    });
    return view;
  };

  const openLibrary = async (section: "active" | "trash" = "active") => {
    fireEvent.click(screen.getByText("Scripts"));
    if (section === "trash")
      fireEvent.click(screen.getByRole("button", { name: /Trash \(\d+\)/ }));
  };

  beforeEach(() => {
    resetPromptQueueForTests();
    resetSSHCommandHistoryMemoryForTests();
    onClose.mockReset();
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.spyOn(bulkScriptsStore, "load").mockImplementation(async () => ({
      value: cloneSnapshot(durable),
      sanitized: false,
    }));
    vi.spyOn(bulkScriptsStore, "save").mockImplementation(async (value) => {
      durable = cloneSnapshot(value);
      return { value: cloneSnapshot(durable), changed: false };
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(window, "prompt").mockReturnValue("yes");
  });

  afterEach(() => {
    const nativeCalls = nativeDialogCalls();
    // Tidy up first, so that one failure here cannot leak into the next test.
    cleanup();
    vi.restoreAllMocks();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    // No flow here may fall back to a native box.
    expect(nativeCalls).toEqual({ confirm: 0, alert: 0, prompt: 0 });
  });

  let trustRecord: string | null = null;
  beforeEach(() => {
    vi.stubGlobal("crypto", webcrypto);
    trustRecord = null;
    vi.mocked(invoke).mockImplementation(async (command, args: any) => {
      if (command === "read_app_data") return trustRecord;
      if (command === "compare_and_swap_app_data") {
        if (trustRecord !== args.expected) return false;
        trustRecord = args.replacement;
        return true;
      }
      return undefined;
    });
  });
  const loadSaved = async () => {
    await openCommander({ config: { runConfirmation: "always" } });
    await openLibrary();
    fireEvent.click(
      screen.getByRole("button", { name: /Load Lifecycle script/ }),
    );
  };
  const lastingConfirm = async () => {
    await screen.findByTestId("app-prompt");
    trustedClick(
      screen
        .getAllByTestId("app-prompt-choice")
        .find((radio) => radio.getAttribute("value") === "everywhere")!,
    );
    await new Promise((resolve) => setTimeout(resolve, 320));
    await act(async () => {
      trustedClick(confirmButton());
    });
  };
  it("offers lasting trust only for a loaded unmodified script, then reads it fresh on every send", async () => {
    await loadSaved();
    pressSend();
    await screen.findByTestId("app-prompt");
    expect(screen.getAllByTestId("app-prompt-choice")).toHaveLength(2);
    await lastingConfirm();
    await waitFor(() => expect(sends()).toHaveLength(2));
    expect(trustRecord).not.toContain(customScript.script);
    expect(JSON.parse(trustRecord!).entries).toHaveLength(1);
    await waitFor(() => expect(editor()).toHaveValue(""));
    await openLibrary();
    fireEvent.click(
      screen.getByRole("button", { name: /Load Lifecycle script/ }),
    );
    pressSend();
    await waitFor(() => expect(sends()).toHaveLength(4));
    expect(prompts()).toHaveLength(0);
    expect(
      toasts().some((toast) => toast.textContent?.includes("trusted")),
    ).toBe(true);
    await waitFor(() => expect(editor()).toHaveValue(""));
    await openLibrary();
    trustRecord = null;
    fireEvent.click(
      screen.getByRole("button", { name: /Load Lifecycle script/ }),
    );
    pressSend();
    await screen.findByTestId("app-prompt");
  });
  it("edited and typed commands have no lasting choices", async () => {
    await loadSaved();
    typeCommand("uname -a # changed");
    pressSend();
    await screen.findByTestId("app-prompt");
    expect(screen.queryByTestId("app-prompt-choices")).not.toBeInTheDocument();
  });
  it.each(["edited", "deleted"])(
    "rechecks the durable saved library after a prompt when its script was %s in another window",
    async (change) => {
      await loadSaved();
      pressSend();
      await screen.findByTestId("app-prompt");
      // No same-window storage event: the durable library is the authority.
      durable.active =
        change === "deleted" ? [] : [{ ...customScript, script: "uptime" }];
      clickWithMouse(confirmButton());
      await waitFor(() =>
        expect(
          toasts().some((toast) =>
            toast.textContent?.includes("saved script changed"),
          ),
        ).toBe(true),
      );
      expect(sends()).toHaveLength(0);
      expect(trustRecord).toBeNull();
    },
  );
  it("rechecks the saved library again after a lasting grant waits on storage", async () => {
    await loadSaved();
    const originalInvoke = vi.mocked(invoke).getMockImplementation()!;
    let releaseGrant: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation(async (command, args: any) => {
      if (command === "compare_and_swap_app_data")
        return new Promise<boolean>((resolve) => {
          releaseGrant = () => {
            trustRecord = args.replacement;
            resolve(true);
          };
        });
      return originalInvoke(command, args);
    });
    pressSend();
    await lastingConfirm();
    await waitFor(() => expect(releaseGrant).toBeDefined());
    durable.active = [];
    await act(async () => releaseGrant!());
    await waitFor(() =>
      expect(
        toasts().some((toast) =>
          toast.textContent?.includes("saved script changed"),
        ),
      ).toBe(true),
    );
    expect(sends()).toHaveLength(0);
  });
  it("Cancel selected lasting trust saves nothing and sends nothing", async () => {
    await loadSaved();
    pressSend();
    await screen.findByTestId("app-prompt");
    trustedClick(screen.getAllByTestId("app-prompt-choice")[1]);
    fireEvent.click(cancelButton());
    expect(trustRecord).toBeNull();
    expect(sends()).toHaveLength(0);
  });
  it("two sends while the review is in flight send once", async () => {
    await loadSaved();
    pressSend();
    pressSend();
    await lastingConfirm();
    await waitFor(() => expect(sends()).toHaveLength(2));
  });
  it("warns for destructive lasting trust and keeps Cancel focused", async () => {
    await openCommander({
      active: [destructiveScript],
      config: { runConfirmation: "always" },
    });
    await openLibrary();
    fireEvent.click(screen.getByRole("button", { name: /Load Restart host/ }));
    pressSend();
    await screen.findByTestId("app-prompt");
    expect(screen.getByTestId("app-prompt-choices-note")).toHaveTextContent(
      "destructive",
    );
    await waitFor(() => expect(cancelButton()).toHaveFocus());
    fireEvent.click(cancelButton());
    expect(trustRecord).toBeNull();
  });
  it("Never preserves policy behavior and does not consult on send", async () => {
    await openCommander({ config: { runConfirmation: "never" } });
    await openLibrary();
    fireEvent.click(
      screen.getByRole("button", { name: /Load Lifecycle script/ }),
    );
    vi.mocked(invoke).mockClear();
    pressSend();
    await waitFor(() => expect(sends()).toHaveLength(2));
    expect(prompts()).toHaveLength(0);
    expect(
      vi
        .mocked(invoke)
        .mock.calls.filter(([command]) => command === "read_app_data"),
    ).toHaveLength(0);
  });
});
