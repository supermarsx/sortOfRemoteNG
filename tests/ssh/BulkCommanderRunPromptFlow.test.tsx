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

  describe("sending a command", () => {
    it("asks in the app's own dialog, naming the command and every session, with Cancel focused for a destructive command", async () => {
      await openCommander();
      typeCommand("reboot");
      pressSend();

      const dialog = screen.getByRole("dialog", {
        name: "Send a destructive command to 2 SSH sessions?",
      });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAccessibleDescription(
        "This command may make destructive changes on every selected session.",
      );
      const targets = within(screen.getByTestId("app-prompt-targets"));
      expect(targets.getByText("SSH Server 1")).toBeInTheDocument();
      expect(targets.getByText("192.168.1.101")).toBeInTheDocument();
      expect(targets.getByText("SSH Server 2")).toBeInTheDocument();
      expect(targets.getByText("192.168.1.102")).toBeInTheDocument();
      expect(screen.getByTestId("app-prompt-preview")).toHaveTextContent(
        /^reboot$/,
      );
      expect(confirmButton()).toHaveTextContent("Send to 2 sessions");
      expect(confirmButton()).toHaveAttribute("data-tone", "danger");
      expect(screen.getByTestId("app-prompt-hint")).toHaveTextContent(
        "Script library, Confirm run: Destructive",
      );
      expect(screen.queryByTestId("app-prompt-remember")).toBeNull();
      await waitFor(() => expect(cancelButton()).toHaveFocus());

      // Nothing has happened yet.
      expect(sends()).toEqual([]);
      expect(screen.queryByText("Running...")).toBeNull();
    });

    it("sends nothing, records nothing and reports nothing on Cancel, and gives the focus back", async () => {
      await openCommander();
      typeCommand("reboot");
      pressSend();
      await waitFor(() => expect(prompts()).toHaveLength(1));

      await act(async () => {
        clickWithMouse(cancelButton());
      });

      expect(prompts()).toHaveLength(0);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(sends()).toEqual([]);
      expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(0);
      expect(toasts()).toHaveLength(0);
      expect(editor()).toHaveValue("reboot");
      expect(sendButton()).toHaveFocus();
      expect(sendButton()).toBeEnabled();
    });

    it("treats Escape as Cancel for the prompt alone: the commander stays open", async () => {
      await openCommander();
      typeCommand("reboot");
      pressSend();
      await waitFor(() => expect(cancelButton()).toHaveFocus());

      fireEvent.keyDown(cancelButton(), { key: "Escape" });

      expect(prompts()).toHaveLength(0);
      expect(onClose).not.toHaveBeenCalled();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(sends()).toEqual([]);
      expect(toasts()).toHaveLength(0);

      // With no prompt open, Escape is the commander's own again.
      fireEvent.keyDown(editor(), { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("treats a click on the backdrop as Cancel", async () => {
      await openCommander();
      typeCommand("reboot");
      pressSend();

      const backdrop = screen.getByTestId("app-prompt");
      fireEvent.mouseDown(backdrop);
      clickWithMouse(backdrop);

      expect(prompts()).toHaveLength(0);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(sends()).toEqual([]);
      expect(toasts()).toHaveLength(0);
    });

    it("on confirm sends the previewed text once to each listed session", async () => {
      await openCommander();
      typeCommand("  systemctl restart nginx  \n");
      pressSend();
      const previewed = screen.getByTestId("app-prompt-preview").textContent;
      expect(previewed).toBe("systemctl restart nginx");

      clickWithMouse(confirmButton());

      expect(prompts()).toHaveLength(0);
      await waitFor(() =>
        expect(sends()).toEqual([
          { sessionId: "backend-1", data: `${previewed}\n` },
          { sessionId: "backend-2", data: `${previewed}\n` },
        ]),
      );
      await waitFor(() => {
        const history = getSSHCommandHistoryMemorySnapshot();
        expect(history).toHaveLength(1);
        expect(history[0].executions).toHaveLength(2);
      });
      expect(prompts()).toHaveLength(0);
      expect(toasts()).toHaveLength(0);
    });

    it("draws one dialog however often Send and Ctrl+Enter are used while it is open", async () => {
      await openCommander();
      typeCommand("reboot");
      pressSend();

      fireEvent.click(sendButton());
      fireEvent.keyDown(editor(), { key: "Enter", ctrlKey: true });
      fireEvent.click(sendButton());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      await waitFor(() => expect(prompts()).toHaveLength(1));
      expect(screen.queryByTestId("app-prompt-queue")).toBeNull();

      clickWithMouse(confirmButton());
      await waitFor(() => expect(sends()).toHaveLength(2));
      await waitFor(() =>
        expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(1),
      );
      expect(prompts()).toHaveLength(0);
      expect(sends()).toHaveLength(2);
    });

    it("sends nothing and says so when a session is deselected while the prompt is open", async () => {
      await openCommander();
      typeCommand("reboot");
      pressSend();

      fireEvent.click(
        screen.getByRole("button", {
          name: "Remove SSH Server 1 from command recipients",
        }),
      );
      // The prompt still shows what was reviewed.
      expect(
        within(screen.getByTestId("app-prompt-targets")).getByText(
          "SSH Server 1",
        ),
      ).toBeInTheDocument();
      clickWithMouse(confirmButton());

      expect(await screen.findByText(SELECTION_CHANGED)).toBeInTheDocument();
      expect(prompts()).toHaveLength(0);
      expect(sends()).toEqual([]);
      expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(0);
      expect(editor()).toHaveValue("reboot");
    });

    it("sends nothing and says so when a session disconnects while the prompt is open", async () => {
      const view = await openCommander();
      typeCommand("reboot");
      pressSend();

      world.sessions = [sshSession(1)];
      view.rerender(<AppWindow />);
      clickWithMouse(confirmButton());

      expect(await screen.findByText(SELECTION_CHANGED)).toBeInTheDocument();
      expect(sends()).toEqual([]);
      expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(0);

      // Asking again reviews the sessions that are left.
      pressSend();
      expect(
        screen.getByRole("dialog", {
          name: "Send a destructive command to 1 SSH session?",
        }),
      ).toBeInTheDocument();
      clickWithMouse(confirmButton());
      await waitFor(() =>
        expect(sends()).toEqual([{ sessionId: "backend-1", data: "reboot\n" }]),
      );
    });

    it("lists two sessions that share a name and host, and refuses the send when one is swapped for a third namesake", async () => {
      const namesake = (index: number) => ({
        ...sshSession(index),
        name: "web",
        hostname: "10.0.0.5",
      });
      await openCommander({
        sessions: [namesake(1), namesake(2), namesake(3)],
      });
      const recipients = (label: string) =>
        screen.getAllByRole("button", { name: label });
      // Sessions 1 and 2 stay selected.
      fireEvent.click(recipients("Remove web from command recipients")[2]);
      typeCommand("reboot");
      pressSend();

      expect(
        screen.getByRole("dialog", {
          name: "Send a destructive command to 2 SSH sessions?",
        }),
      ).toBeInTheDocument();
      const targets = within(screen.getByTestId("app-prompt-targets"));
      expect(targets.getAllByRole("listitem")).toHaveLength(2);
      expect(targets.getAllByText("web")).toHaveLength(2);
      expect(targets.getAllByText("10.0.0.5")).toHaveLength(2);

      // Session 2 is swapped for session 3: the same count, names and hosts.
      fireEvent.click(recipients("Remove web from command recipients")[1]);
      fireEvent.click(recipients("Add web to command recipients")[1]);
      expect(recipients("Remove web from command recipients")).toHaveLength(2);
      clickWithMouse(confirmButton());

      expect(await screen.findByText(SELECTION_CHANGED)).toBeInTheDocument();
      expect(prompts()).toHaveLength(0);
      expect(sends()).toEqual([]);
      expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(0);
    });

    it("sends to each of two sessions that share a name when nothing changed", async () => {
      const namesake = (index: number) => ({
        ...sshSession(index),
        name: "web",
        hostname: "10.0.0.5",
      });
      await openCommander({ sessions: [namesake(1), namesake(2)] });
      typeCommand("reboot");
      pressSend();

      clickWithMouse(confirmButton());

      await waitFor(() =>
        expect(sends()).toEqual([
          { sessionId: "backend-1", data: "reboot\n" },
          { sessionId: "backend-2", data: "reboot\n" },
        ]),
      );
      expect(toasts()).toHaveLength(0);
    });

    it("sends nothing and says so when the command is edited while the prompt is open", async () => {
      await openCommander();
      typeCommand("reboot");
      pressSend();

      typeCommand("reboot --force");
      expect(screen.getByTestId("app-prompt-preview")).toHaveTextContent(
        /^reboot$/,
      );
      clickWithMouse(confirmButton());

      expect(
        await screen.findByText(
          "The command changed while you were reviewing. Nothing was sent.",
        ),
      ).toBeInTheDocument();
      expect(prompts()).toHaveLength(0);
      expect(sends()).toEqual([]);
      expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(0);
      expect(editor()).toHaveValue("reboot --force");
    });

    it('with "Confirm run" set to Never sends at once, without a dialog', async () => {
      await openCommander({ config: { runConfirmation: "never" } });
      typeCommand("reboot");
      pressSend();

      expect(prompts()).toHaveLength(0);
      await waitFor(() => expect(sends()).toHaveLength(2));
      expect(prompts()).toHaveLength(0);
    });

    it("does not ask about an ordinary command under the default policy", async () => {
      await openCommander();
      typeCommand("uptime");
      pressSend();

      expect(prompts()).toHaveLength(0);
      await waitFor(() => expect(sends()).toHaveLength(2));
    });

    it('with "Confirm run" set to Always asks about an ordinary command, with the send button focused', async () => {
      await openCommander({ config: { runConfirmation: "always" } });
      typeCommand("uptime");
      pressSend();

      expect(
        screen.getByRole("dialog", {
          name: "Send this command to 2 SSH sessions?",
        }),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("app-prompt-message")).toBeNull();
      expect(confirmButton()).toHaveAttribute("data-tone", "default");
      expect(screen.getByTestId("app-prompt-hint")).toHaveTextContent(
        "Script library, Confirm run: Always",
      );
      await waitFor(() => expect(confirmButton()).toHaveFocus());
      expect(sends()).toEqual([]);

      clickWithMouse(confirmButton());
      await waitFor(() =>
        expect(sends()).toEqual([
          { sessionId: "backend-1", data: "uptime\n" },
          { sessionId: "backend-2", data: "uptime\n" },
        ]),
      );
    });

    it("shows session names and hosts as text, whatever they contain", async () => {
      await openCommander({
        sessions: [
          { ...sshSession(1), name: "<b>web</b>", hostname: "<i>10.0.0.1</i>" },
        ],
      });
      typeCommand("reboot");
      pressSend();

      const targets = screen.getByTestId("app-prompt-targets");
      expect(within(targets).getByText("<b>web</b>")).toBeInTheDocument();
      expect(within(targets).getByText("<i>10.0.0.1</i>")).toBeInTheDocument();
      expect(targets.querySelector("b, i")).toBeNull();
    });

    it("keeps the window working while the prompt is open", async () => {
      vi.mocked(invoke).mockImplementation(async (command) =>
        command === "get_terminal_buffer" ? "still streaming" : undefined,
      );
      await openCommander();
      typeCommand("reboot");
      const tick = vi.fn();
      setTimeout(tick, 0);
      pressSend();

      fireEvent.click(
        screen.getByRole("button", { name: "Peek SSH Server 1" }),
      );

      expect(await screen.findByText("still streaming")).toBeInTheDocument();
      await waitFor(() => expect(tick).toHaveBeenCalled());
      await waitFor(() => expect(prompts()).toHaveLength(1));
      expect(sends()).toEqual([]);
    });

    it("closes the prompt and sends nothing when the commander goes away", async () => {
      const view = await openCommander();
      typeCommand("reboot");
      pressSend();
      await waitFor(() => expect(prompts()).toHaveLength(1));

      view.rerender(<AppWindow commander={false} />);

      expect(prompts()).toHaveLength(0);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(sends()).toEqual([]);
      expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(0);
      expect(toasts()).toHaveLength(0);
    });

    it("sends nothing and says so in a window that has no prompt host", async () => {
      await openCommander({ host: false });
      typeCommand("reboot");
      pressSend();

      expect(
        await screen.findByText(
          "The confirmation could not be shown. Nothing was sent.",
        ),
      ).toBeInTheDocument();
      expect(sends()).toEqual([]);
      expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(0);
      expect(editor()).toHaveValue("reboot");
    });
  });

  describe("loading a destructive script", () => {
    it("fills the editor without asking and without sending, and the run then asks exactly once", async () => {
      await openCommander({ active: [destructiveScript] });
      await openLibrary();

      fireEvent.click(
        await screen.findByRole("button", { name: "Load Restart host" }),
      );

      expect(prompts()).toHaveLength(0);
      expect(editor()).toHaveValue("reboot");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(vi.mocked(invoke)).not.toHaveBeenCalled();

      pressSend();
      await waitFor(() => expect(prompts()).toHaveLength(1));
      expect(
        screen.getByRole("dialog", {
          name: "Send a destructive command to 2 SSH sessions?",
        }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("app-prompt-facts")).toHaveTextContent(
        'Script "Restart host"',
      );
      expect(screen.getByTestId("app-prompt-preview")).toHaveTextContent(
        /^reboot$/,
      );
      await waitFor(() => expect(cancelButton()).toHaveFocus());
      expect(sends()).toEqual([]);

      clickWithMouse(confirmButton());
      await waitFor(() =>
        expect(sends()).toEqual([
          { sessionId: "backend-1", data: "reboot\n" },
          { sessionId: "backend-2", data: "reboot\n" },
        ]),
      );
      await waitFor(() =>
        expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(1),
      );
      expect(prompts()).toHaveLength(0);
    });
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

    const loadFromLibrary = async (name: string) => {
      fireEvent.click(screen.getByText("Scripts"));
      fireEvent.click(
        await screen.findByRole("button", { name: `Load ${name}` }),
      );
    };

    it("asks once, as destructive, when it is loaded, edited and sent", async () => {
      await openCommander({ active: [flagged] });
      await loadFromLibrary("Rotate keys");
      expect(editor()).toHaveValue("uname -a");

      typeCommand("uname -r");
      expect(prompts()).toHaveLength(0);
      pressSend();

      await waitFor(() => expect(prompts()).toHaveLength(1));
      expect(
        screen.getByRole("dialog", {
          name: "Send a destructive command to 2 SSH sessions?",
        }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("app-prompt-facts")).toHaveTextContent(
        'Script "Rotate keys (edited)"',
      );
      expect(screen.getByTestId("app-prompt-preview")).toHaveTextContent(
        /^uname -r$/,
      );
      expect(confirmButton()).toHaveAttribute("data-tone", "danger");
      await waitFor(() => expect(cancelButton()).toHaveFocus());
      expect(sends()).toEqual([]);

      clickWithMouse(confirmButton());
      await waitFor(() =>
        expect(sends()).toEqual([
          { sessionId: "backend-1", data: "uname -r\n" },
          { sessionId: "backend-2", data: "uname -r\n" },
        ]),
      );
      expect(prompts()).toHaveLength(0);
    });

    it("does not ask about a harmless command typed after the editor was cleared", async () => {
      await openCommander({ active: [flagged] });
      await loadFromLibrary("Rotate keys");

      typeCommand("");
      typeCommand("uptime");
      pressSend();

      expect(prompts()).toHaveLength(0);
      await waitFor(() =>
        expect(sends()).toEqual([
          { sessionId: "backend-1", data: "uptime\n" },
          { sessionId: "backend-2", data: "uptime\n" },
        ]),
      );
    });

    it("does not ask after another, unflagged script was loaded over it", async () => {
      await openCommander({ active: [flagged, customScript] });
      await loadFromLibrary("Rotate keys");
      typeCommand("uname -r");
      await loadFromLibrary("Lifecycle script");
      expect(editor()).toHaveValue("uname -a");

      pressSend();

      expect(prompts()).toHaveLength(0);
      await waitFor(() => expect(sends()).toHaveLength(2));
    });

    it("asks again when ten blanks typed over the whole script are undone", async () => {
      // Eleven characters: one more than the blanks the editor holds before the undo.
      const rotate: BulkScript = {
        ...flagged,
        id: "custom-rotate",
        name: "Rotate now",
        script: "rotate-keys",
      };
      await openCommander({ active: [rotate] });
      await loadFromLibrary("Rotate now");
      expect(editor()).toHaveValue("rotate-keys");

      for (let blanks = 1; blanks <= 10; blanks += 1)
        typeCommand(" ".repeat(blanks));
      // The undo arrives as one change of the whole text.
      typeCommand("rotate-keys");
      pressSend();

      await waitFor(() => expect(prompts()).toHaveLength(1));
      expect(
        screen.getByRole("dialog", {
          name: "Send a destructive command to 2 SSH sessions?",
        }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("app-prompt-facts")).toHaveTextContent(
        'Script "Rotate now"',
      );
      await waitFor(() => expect(cancelButton()).toHaveFocus());
      await act(async () => {
        clickWithMouse(cancelButton());
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(sends()).toEqual([]);
    });

    it("does not ask when the script is typed again by hand after the editor was cleared", async () => {
      await openCommander({ active: [flagged] });
      await loadFromLibrary("Rotate keys");

      typeCommand("");
      for (let length = 1; length <= "uname -a".length; length += 1)
        typeCommand("uname -a".slice(0, length));
      pressSend();

      expect(prompts()).toHaveLength(0);
      await waitFor(() =>
        expect(sends()).toEqual([
          { sessionId: "backend-1", data: "uname -a\n" },
          { sessionId: "backend-2", data: "uname -a\n" },
        ]),
      );
    });

    describe("with the kind of change the text area reports", () => {
      // What a real text area announces with each change: a keystroke is
      // "insertText"; a delete, an undo, a redo and a paste each say so.
      const changeCommand = (value: string, inputType: string) =>
        fireEvent.input(editor(), { target: { value }, inputType });

      const expectAskedAndCancel = async (name: string) => {
        await waitFor(() => expect(prompts()).toHaveLength(1));
        expect(
          screen.getByRole("dialog", {
            name: "Send a destructive command to 2 SSH sessions?",
          }),
        ).toBeInTheDocument();
        expect(screen.getByTestId("app-prompt-facts")).toHaveTextContent(
          `Script "${name}"`,
        );
        await waitFor(() => expect(cancelButton()).toHaveFocus());
        await act(async () => {
          clickWithMouse(cancelButton());
        });
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(sends()).toEqual([]);
      };

      const oneKey: BulkScript = {
        ...flagged,
        id: "custom-one-key",
        name: "One key",
        script: "k",
      };

      it("asks again when a one-character script is deleted and the delete is undone", async () => {
        await openCommander({ active: [oneKey] });
        await loadFromLibrary("One key");
        expect(editor()).toHaveValue("k");

        changeCommand("", "deleteContentBackward");
        changeCommand("k", "historyUndo");
        pressSend();

        await expectAskedAndCancel("One key");
      });

      it("asks again for a one-character script pasted back into the emptied editor", async () => {
        await openCommander({ active: [oneKey] });
        await loadFromLibrary("One key");

        changeCommand("", "deleteByCut");
        changeCommand("k", "insertFromPaste");
        pressSend();

        await expectAskedAndCancel("One key");
      });

      it("asks again when two deletes are undone one at a time", async () => {
        const twoKeys: BulkScript = {
          ...flagged,
          id: "custom-two-keys",
          name: "Two keys",
          script: "rk",
        };
        await openCommander({ active: [twoKeys] });
        await loadFromLibrary("Two keys");

        changeCommand("r", "deleteContentBackward");
        changeCommand("", "deleteContentBackward");
        changeCommand("r", "historyUndo");
        changeCommand("rk", "historyUndo");
        pressSend();

        await expectAskedAndCancel("Two keys");
      });

      it("asks again when ten blanks typed over the whole script are undone, then redone and undone again", async () => {
        const rotate: BulkScript = {
          ...flagged,
          id: "custom-rotate",
          name: "Rotate now",
          script: "rotate-keys",
        };
        await openCommander({ active: [rotate] });
        await loadFromLibrary("Rotate now");

        for (let blanks = 1; blanks <= 10; blanks += 1)
          changeCommand(" ".repeat(blanks), "insertText");
        changeCommand("rotate-keys", "historyUndo");
        changeCommand(" ".repeat(10), "historyRedo");
        changeCommand("rotate-keys", "historyUndo");
        pressSend();

        await expectAskedAndCancel("Rotate now");
      });

      it("still takes a keystroke for typing: the script typed again by hand is not asked about", async () => {
        await openCommander({ active: [oneKey] });
        await loadFromLibrary("One key");

        changeCommand("", "deleteContentBackward");
        changeCommand("k", "insertText");
        pressSend();

        expect(prompts()).toHaveLength(0);
        await waitFor(() =>
          expect(sends()).toEqual([
            { sessionId: "backend-1", data: "k\n" },
            { sessionId: "backend-2", data: "k\n" },
          ]),
        );
      });
    });

    it("lets go when Arrow Up puts a history entry over it, and asks again when Arrow Down brings its text back", async () => {
      await openCommander({ active: [flagged] });
      // A first send gives the history something to offer.
      typeCommand("uptime");
      pressSend();
      await waitFor(() => expect(sends()).toHaveLength(2));
      await waitFor(() =>
        expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(1),
      );
      await waitFor(() => expect(editor()).toHaveValue(""));
      vi.mocked(invoke).mockClear();

      await loadFromLibrary("Rotate keys");
      typeCommand("uname -r");
      fireEvent.keyDown(editor(), { key: "ArrowUp" });
      expect(editor()).toHaveValue("uptime");
      fireEvent.keyDown(editor(), { key: "ArrowDown" });
      expect(editor()).toHaveValue("uname -r");

      pressSend();
      await waitFor(() => expect(prompts()).toHaveLength(1));
      expect(screen.getByTestId("app-prompt-facts")).toHaveTextContent(
        'Script "Rotate keys (edited)"',
      );
      await act(async () => {
        clickWithMouse(cancelButton());
      });
      expect(prompts()).toHaveLength(0);
      expect(sends()).toEqual([]);

      // The history entry itself is sent without asking.
      fireEvent.keyDown(editor(), { key: "ArrowUp" });
      expect(editor()).toHaveValue("uptime");
      pressSend();
      expect(prompts()).toHaveLength(0);
      await waitFor(() =>
        expect(sends()).toEqual([
          { sessionId: "backend-1", data: "uptime\n" },
          { sessionId: "backend-2", data: "uptime\n" },
        ]),
      );
    });
  });

  describe("the arrow keys in the editor", () => {
    const twoSteps: BulkScript = {
      ...customScript,
      id: "custom-two-steps",
      name: "Two steps",
      script: "echo one\necho two",
    };

    const loadTwoSteps = async () => {
      fireEvent.click(screen.getByText("Scripts"));
      fireEvent.click(
        await screen.findByRole("button", { name: "Load Two steps" }),
      );
      expect(editor()).toHaveValue("echo one\necho two");
    };

    /** Sends a harmless command so that the history has an entry to offer. */
    const sendForHistory = async (command: string) => {
      typeCommand(command);
      pressSend();
      await waitFor(() => expect(sends()).toHaveLength(2));
      await waitFor(() =>
        expect(getSSHCommandHistoryMemorySnapshot()).toHaveLength(1),
      );
      await waitFor(() => expect(editor()).toHaveValue(""));
    };

    /** True when the key was left to the text area, which then moves the caret. */
    const pressKey = (key: "ArrowUp" | "ArrowDown") =>
      fireEvent.keyDown(editor(), { key });

    it("Arrow Down leaves a freshly loaded script of several lines in the editor", async () => {
      await openCommander({ active: [twoSteps] });
      await loadTwoSteps();

      expect(pressKey("ArrowDown")).toBe(true);
      expect(editor()).toHaveValue("echo one\necho two");
      expect(pressKey("ArrowUp")).toBe(true);
      expect(editor()).toHaveValue("echo one\necho two");
    });

    it("leaves it there with a history to offer as well", async () => {
      await openCommander({ active: [twoSteps] });
      await sendForHistory("uptime");
      await loadTwoSteps();

      expect(pressKey("ArrowUp")).toBe(true);
      expect(editor()).toHaveValue("echo one\necho two");
      expect(pressKey("ArrowDown")).toBe(true);
      expect(editor()).toHaveValue("echo one\necho two");
    });

    it("a one-line draft still steps into the history and comes back", async () => {
      await openCommander();
      await sendForHistory("uptime");
      typeCommand("df -h");

      expect(pressKey("ArrowUp")).toBe(false);
      expect(editor()).toHaveValue("uptime");
      expect(pressKey("ArrowDown")).toBe(false);
      expect(editor()).toHaveValue("df -h");
      // The navigation is over: Arrow Down has nothing more to do.
      expect(pressKey("ArrowDown")).toBe(true);
      expect(editor()).toHaveValue("df -h");
    });

    it("Arrow Down does nothing to a one-line text when there was no navigation", async () => {
      await openCommander();
      await sendForHistory("uptime");
      typeCommand("df -h");

      expect(pressKey("ArrowDown")).toBe(true);
      expect(editor()).toHaveValue("df -h");
    });

    it("steps on through an entry of several lines that the keys recalled, until it is edited", async () => {
      await openCommander();
      await sendForHistory("echo one\necho two");

      expect(pressKey("ArrowUp")).toBe(false);
      expect(editor()).toHaveValue("echo one\necho two");
      // Untouched, it is still the history's: Arrow Down goes back to the draft.
      expect(pressKey("ArrowDown")).toBe(false);
      expect(editor()).toHaveValue("");

      expect(pressKey("ArrowUp")).toBe(false);
      typeCommand("echo one\necho two # mine");
      expect(pressKey("ArrowUp")).toBe(true);
      expect(pressKey("ArrowDown")).toBe(true);
      expect(editor()).toHaveValue("echo one\necho two # mine");
    });
  });

  describe("deleting from the script library", () => {
    it("asks before a move to the trash when the policy says Always, cancels cleanly and moves once on confirm", async () => {
      await openCommander({ config: { deleteConfirmation: "always" } });
      await openLibrary();
      const moveToTrash = await screen.findByTitle("Move to trash");

      fireEvent.click(moveToTrash);
      expect(
        screen.getByRole("dialog", {
          name: 'Move "Lifecycle script" to trash?',
        }),
      ).toHaveAccessibleDescription("You can restore it from the trash.");
      expect(confirmButton()).toHaveTextContent("Move to trash");
      await waitFor(() => expect(confirmButton()).toHaveFocus());

      await act(async () => {
        clickWithMouse(cancelButton());
      });
      expect(prompts()).toHaveLength(0);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(bulkScriptsStore.save).not.toHaveBeenCalled();
      expect(toasts()).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: "Load Lifecycle script" }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByTitle("Move to trash"));
      clickWithMouse(confirmButton());
      await waitFor(() =>
        expect(durable.trash.map((script) => script.id)).toEqual([
          customScript.id,
        ]),
      );
      expect(bulkScriptsStore.save).toHaveBeenCalledTimes(1);
      expect(durable.active).toEqual([]);
      expect(prompts()).toHaveLength(0);
    });

    it("moves to the trash without asking under the default policy", async () => {
      await openCommander();
      await openLibrary();

      fireEvent.click(await screen.findByTitle("Move to trash"));

      expect(prompts()).toHaveLength(0);
      await waitFor(() => expect(durable.trash).toHaveLength(1));
    });

    it("asks before a permanent delete with Cancel focused, cancels cleanly and deletes once on confirm", async () => {
      await openCommander({ active: [], trash: [trashed(1), trashed(2)] });
      await openLibrary("trash");
      const [deleteFirst] = await screen.findAllByTitle("Delete permanently");

      fireEvent.click(deleteFirst);
      expect(
        screen.getByRole("dialog", {
          name: 'Permanently delete "Old script 1"?',
        }),
      ).toHaveAccessibleDescription("This cannot be undone.");
      expect(confirmButton()).toHaveTextContent("Delete permanently");
      expect(confirmButton()).toHaveAttribute("data-tone", "danger");
      await waitFor(() => expect(cancelButton()).toHaveFocus());

      await act(async () => {
        clickWithMouse(cancelButton());
      });
      expect(prompts()).toHaveLength(0);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(bulkScriptsStore.save).not.toHaveBeenCalled();
      expect(toasts()).toHaveLength(0);
      expect(screen.getByText("Old script 1")).toBeInTheDocument();

      fireEvent.click(screen.getAllByTitle("Delete permanently")[0]);
      clickWithMouse(confirmButton());
      await waitFor(() =>
        expect(durable.trash.map((script) => script.id)).toEqual([
          "custom-trashed-2",
        ]),
      );
      expect(bulkScriptsStore.save).toHaveBeenCalledTimes(1);
      expect(prompts()).toHaveLength(0);
    });

    it("asks before emptying the trash with Cancel focused, cancels cleanly and empties once on confirm", async () => {
      await openCommander({ active: [], trash: [trashed(1), trashed(2)] });
      await openLibrary("trash");
      const emptyTrash = await screen.findByRole("button", {
        name: "Empty trash",
      });

      fireEvent.click(emptyTrash);
      expect(
        screen.getByRole("dialog", {
          name: "Permanently delete 2 trashed scripts?",
        }),
      ).toHaveAccessibleDescription("This cannot be undone.");
      expect(confirmButton()).toHaveTextContent("Empty trash");
      await waitFor(() => expect(cancelButton()).toHaveFocus());

      await act(async () => {
        clickWithMouse(cancelButton());
      });
      expect(prompts()).toHaveLength(0);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(bulkScriptsStore.save).not.toHaveBeenCalled();
      expect(toasts()).toHaveLength(0);
      expect(durable.trash).toHaveLength(2);

      fireEvent.click(emptyTrash);
      clickWithMouse(confirmButton());
      await waitFor(() => expect(durable.trash).toEqual([]));
      expect(bulkScriptsStore.save).toHaveBeenCalledTimes(1);
      expect(prompts()).toHaveLength(0);
    });

    it('deletes permanently without asking when "Confirm delete" is Never', async () => {
      await openCommander({
        active: [],
        trash: [trashed(1)],
        config: { deleteConfirmation: "never" },
      });
      await openLibrary("trash");

      fireEvent.click(await screen.findByTitle("Delete permanently"));

      expect(prompts()).toHaveLength(0);
      await waitFor(() => expect(durable.trash).toEqual([]));
    });
  });
});
