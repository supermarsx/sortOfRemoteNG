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
import { WebTerminal } from "../../src/components/ssh/WebTerminal";
import { PromptHost } from "../../src/components/ui/dialogs/PromptHost";
import {
  getPromptSnapshot,
  resetPromptQueueForTests,
} from "../../src/utils/prompts/promptQueue";
import {
  sshMacroReplayPrompt,
  sshScriptRunPrompt,
  terminalPastePrompt,
} from "../../src/utils/prompts/runPromptRequests";
import { defaultSettings } from "../../src/contexts/SettingsContext";
import type { ConnectionSession } from "../../src/types/connection/connection";
import type { ManagedScript } from "../../src/components/recording/scriptManager/shared";
import type { TerminalMacro } from "../../src/types/recording/macroTypes";

// The SSH terminal's three confirmations (run a script, replay a macro, paste
// risky text) through the real prompt queue, host and dialog. Nothing here
// touches the OS clipboard: pasted text arrives in a synthetic paste event or
// from the fake `navigator.clipboard` installed below.

const h = vi.hoisted(() => {
  const disposable = () => ({ dispose: vi.fn() });
  const terminal = {
    loadAddon: vi.fn(),
    open: vi.fn(),
    focus: vi.fn(),
    write: vi.fn((_data: string, done?: () => void) => done?.()),
    writeln: vi.fn(),
    onData: vi.fn(disposable),
    onBell: vi.fn(disposable),
    onRender: vi.fn(disposable),
    onWriteParsed: vi.fn(disposable),
    scrollToBottom: vi.fn(),
    dispose: vi.fn(),
    clear: vi.fn(),
    reset: vi.fn(),
    getSelection: vi.fn(() => ""),
    options: {} as Record<string, unknown>,
    buffer: { active: { length: 0, getLine: () => undefined } },
    cols: 80,
    rows: 24,
    element: { isConnected: true },
    _core: {
      renderService: {
        dimensions: { css: { cell: { width: 9, height: 17 } } },
      },
    },
  };
  const toast = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => "toast-id"),
    update: vi.fn(),
    remove: vi.fn(),
  });
  return {
    terminal,
    toast,
    invoke: vi.fn(),
    dispatch: vi.fn(),
    listeners: new Map<string, (event: { payload: unknown }) => void>(),
    settings: null as Record<string, unknown> | null,
    library: {
      scripts: [] as unknown[],
      macros: [] as unknown[],
    },
    clipboard: {
      readText: vi.fn(async () => ""),
      writeText: vi.fn(async (_text: string) => undefined),
    },
    connection: {
      id: "flow-connection",
      name: "web-01",
      protocol: "ssh",
      hostname: "192.0.2.10",
      port: 22,
      username: "deploy",
      password: "fixture-password",
      authType: "password",
      isGroup: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => h.invoke(...args),
  isTauri: () => false,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (
    event: string,
    callback: (event: { payload: unknown }) => void,
  ) => {
    h.listeners.set(event, callback);
    return () => {
      if (h.listeners.get(event) === callback) h.listeners.delete(event);
    };
  },
  emit: vi.fn(async () => undefined),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function () {
    return h.terminal;
  }),
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function () {
    return { fit: vi.fn() };
  }),
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: vi.fn(function () {
    return {};
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));
vi.mock("../../src/contexts/ToastContext", () => ({
  useToastContext: () => ({ toast: h.toast }),
}));
vi.mock("../../src/contexts/useConnections", () => ({
  useConnections: () => ({
    state: { connections: [h.connection], sessions: [] },
    dispatch: h.dispatch,
  }),
}));
vi.mock("../../src/contexts/SettingsContext", async (original) => {
  const actual =
    await original<typeof import("../../src/contexts/SettingsContext")>();
  return {
    ...actual,
    useSettings: () => ({
      settings: h.settings ?? actual.defaultSettings,
      settingsReady: true,
      updateSettings: vi.fn(),
      reloadSettings: vi.fn(),
    }),
  };
});
vi.mock("../../src/utils/tauri/invoke", () => ({
  getInvoke: async () => null,
}));
vi.mock("../../src/hooks/security/useRuntimeCredentialVault", () => ({
  useRuntimeCredentialVault: () => async () => null,
}));
vi.mock("../../src/utils/session/runtimeConnectionRegistry", () => ({
  resolveRuntimeConnection: () => h.connection,
}));
vi.mock("../../src/utils/connection/databaseManager", () => ({
  DatabaseManager: {
    getInstance: () => ({
      getCurrentDatabase: () => ({ id: "flow-database" }),
      captureCurrentDatabaseDataTarget: () => ({
        databaseId: "flow-database",
        assertAccessible: () => undefined,
      }),
      onCurrentDatabaseChange: () => () => {},
      onDatabaseAccessChange: () => () => {},
    }),
  },
}));
vi.mock("../../src/utils/auth/trustStore", () => ({
  formatFingerprint: (fingerprint: string) => fingerprint,
  getStoredIdentity: () => undefined,
  isCertificateTrustRecordType: () => false,
  resolveEffectiveTrustPolicy: () => "always-trust",
  trustIdentity: vi.fn(),
  verifyIdentity: vi.fn(),
}));
// The app library has its own adapter tests. Here it is the list the picker
// shows, with the same "is it still what was reviewed" check as the real one.
vi.mock("../../src/hooks/recording/useTerminalAppLibrary", () => {
  const review = (list: () => unknown[]) => (item: unknown) => {
    const reviewed = JSON.stringify(item);
    return async () => {
      if (!list().some((entry) => JSON.stringify(entry) === reviewed))
        throw new Error("The saved entry changed.");
    };
  };
  return {
    useTerminalAppLibrary: () => ({
      available: true,
      error: null,
      scripts: h.library.scripts,
      macros: h.library.macros,
      refresh: async () => undefined,
      captureMacroSave: () => async () => undefined,
      reviewScript: review(() => h.library.scripts),
      reviewMacro: review(() => h.library.macros),
    }),
  };
});

const session: ConnectionSession = {
  ownerDatabaseId: "flow-database",
  id: "flow-session",
  connectionId: h.connection.id,
  name: "web-01",
  status: "connecting",
  startTime: new Date("2026-01-01T00:00:00Z"),
  protocol: "ssh",
  hostname: h.connection.hostname,
};

const diskUsage: ManagedScript = {
  id: "script-disk",
  name: "Disk usage",
  description: "Free space per file system",
  script: "#!/bin/bash\ndf -h\ndu -sh /var/log",
  language: "bash",
  category: "System",
  osTags: ["linux"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};
const uptime: ManagedScript = {
  ...diskUsage,
  id: "script-uptime",
  name: "Uptime",
  description: "How long the host has been up",
  script: "uptime",
};
const restartWeb: TerminalMacro = {
  id: "macro-restart",
  name: "Restart web",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  steps: [
    { command: "sudo systemctl restart nginx", delayMs: 0, sendNewline: true },
    { command: "systemctl is-active nginx", delayMs: 0, sendNewline: false },
  ],
};

/** The session as the terminal names it to the prompt builders. */
const where = { name: session.name, hostname: session.hostname };

/** Everything that reached the remote shell. */
const sent = () =>
  h.invoke.mock.calls.filter(
    ([command]) => command === "send_ssh_input" || command === "execute_script",
  );
const nativeConfirm = () => vi.mocked(window.confirm);

const Tree = ({
  terminal = true,
  host = true,
}: {
  terminal?: boolean;
  host?: boolean;
}) => (
  <>
    {host && <PromptHost />}
    {terminal && <WebTerminal session={session} />}
  </>
);

const mount = async (props: { host?: boolean } = {}) => {
  const view = render(<Tree {...props} />);
  await waitFor(() =>
    expect(screen.getByText("Connected")).toBeInTheDocument(),
  );
  // The terminal focuses itself once when it opens; count only what follows.
  await waitFor(() => expect(h.terminal.open).toHaveBeenCalled());
  // xterm keeps its own input inside the terminal surface and focus() lands
  // there. The mock gets the same, so the tests can see who holds the keyboard.
  const input = document.createElement("textarea");
  input.setAttribute("data-testid", "terminal-input");
  screen.getByTestId("terminal-canvas").appendChild(input);
  h.terminal.focus.mockImplementation(() => input.focus());
  h.terminal.focus.mockClear();
  return view;
};
const terminalInput = () => screen.getByTestId("terminal-input");

const prompt = () => screen.queryByTestId("app-prompt");
const picker = () => screen.queryByTestId("web-terminal-script-selector-modal");
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

const openPicker = async () => {
  // A click puts the keyboard on the toolbar button, as in the app.
  const opener = screen.getByRole("button", { name: "Run Script" });
  opener.focus();
  fireEvent.click(opener);
  await waitFor(() => expect(picker()).toBeInTheDocument());
  // The picker takes the keyboard one frame after it opens. A user picks a
  // row long after that; a test must wait for it, or that frame lands between
  // the pick and the prompt and the picker's focus looks like the opener's.
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
};
/** Picks a script the way a user does: the row has the keyboard when it is clicked. */
const pickScript = async (name: string) => {
  if (!picker()) await openPicker();
  const row = screen.getByText(name).closest("button")!;
  row.focus();
  fireEvent.click(row);
  return row;
};
const pickMacro = async (name: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Replay Macro" }));
  const popover = await screen.findByTestId("web-terminal-macro-popover");
  const item = Array.from(popover.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(name),
  )!;
  item.focus();
  fireEvent.click(item);
};
/** A paste the terminal receives with its own text: no clipboard is read. */
const pasteText = async (text: string) => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: () => text },
  });
  await act(async () => {
    screen.getByTestId("terminal-canvas").dispatchEvent(event);
    await Promise.resolve();
  });
};
/** A real mouse click (`detail` 1), not one a key press synthesises. */
const mouseClick = (element: Element) =>
  fireEvent.click(element, { detail: 1 });
const confirmPrompt = () =>
  act(async () => {
    mouseClick(screen.getByTestId("app-prompt-confirm"));
  });
const cancelPrompt = () =>
  act(async () => {
    mouseClick(screen.getByTestId("app-prompt-cancel"));
  });
/**
 * The text the terminal handed to the queue for review, exactly as passed in.
 * How the dialog draws it (hidden characters, a trailing line feed) is the
 * dialog's business and has its own tests.
 */
const reviewedText = () => getPromptSnapshot()[0]?.request.preview?.text;
const preview = () => screen.getByTestId("app-prompt-preview");
const waitForPickerToClose = () =>
  waitFor(() => expect(picker()).not.toBeInTheDocument());

beforeEach(() => {
  resetPromptQueueForTests();
  vi.clearAllMocks();
  localStorage.clear();
  h.listeners.clear();
  h.settings = null;
  h.library.scripts = [diskUsage, uptime];
  h.library.macros = [restartWeb];
  h.invoke.mockImplementation(async (command: string) => {
    if (command === "read_app_data")
      throw new Error("No native trust store in this legacy fixture");
    if (command === "connect_ssh") return "backend-flow-1";
    if (command === "start_shell") return "shell-flow-1";
    if (command === "execute_script")
      return { stdout: "", stderr: "", exitCode: 0 };
    return undefined;
  });
  h.clipboard.readText.mockResolvedValue("");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: h.clipboard,
  });
  // The webview's own box: every test below ends by proving it stayed shut.
  Object.defineProperty(window, "confirm", {
    configurable: true,
    value: vi.fn(() => true),
  });
});

afterEach(() => {
  // Unmount first: a failed check here must not leave this test's terminal
  // in the document for the next one.
  cleanup();
  expect(nativeConfirm()).not.toHaveBeenCalled();
});

describe("SSH terminal: run a script", () => {
  it("asks in the app's own dialog, over the picker, naming the script, the session and the commands", async () => {
    await mount();
    await pickScript("Disk usage");

    // The shebang line is not sent, so it is not put up for review.
    const expected = sshScriptRunPrompt({
      script: diskUsage,
      command: "df -h\ndu -sh /var/log",
      session: where,
      offerRemember: true,
    });
    const dialog = await screen.findByRole("dialog", { name: expected.title });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(getPromptSnapshot()[0].request).toEqual(expected);
    expect(dialog).toHaveTextContent("Disk usage");
    expect(dialog).toHaveTextContent("web-01");
    expect(preview()).toHaveTextContent("df -h");
    expect(preview()).toHaveTextContent("du -sh /var/log");
    expect(preview()).not.toHaveTextContent("#!/bin/bash");
    expect(screen.getByTestId("app-prompt-confirm")).toHaveTextContent(
      expected.confirmLabel,
    );
    expect(screen.getByTestId("app-prompt-remember")).not.toBeChecked();
    // The picker is still there underneath, and nothing has run.
    expect(picker()).toBeInTheDocument();
    expect(sent()).toEqual([]);
    expect(getPromptSnapshot()).toHaveLength(1);
  });

  it.each(["Cancel", "Escape", "the backdrop"] as const)(
    "sends nothing on %s, keeps the picker open and shows no error",
    async (way) => {
      await mount();
      const row = await pickScript("Disk usage");
      await screen.findByTestId("app-prompt");

      if (way === "Cancel") await cancelPrompt();
      else if (way === "Escape")
        await act(async () => {
          fireEvent.keyDown(document.body, { key: "Escape" });
        });
      else
        await act(async () => {
          fireEvent.mouseDown(screen.getByTestId("app-prompt"));
          mouseClick(screen.getByTestId("app-prompt"));
        });

      await waitFor(() => expect(prompt()).not.toBeInTheDocument());
      await settle();
      expect(sent()).toEqual([]);
      expect(picker()).toBeInTheDocument();
      expect(h.toast.error).not.toHaveBeenCalled();
      // The keyboard is back on the row that was picked, not in the terminal
      // behind the picker.
      expect(document.activeElement).toBe(row);
      expect(h.terminal.focus).not.toHaveBeenCalled();

      // Not stuck: the same script can be picked again and asks again.
      await pickScript("Disk usage");
      expect(await screen.findByTestId("app-prompt")).toBeInTheDocument();
    },
  );

  it("on confirm sends the reviewed text once; the dialog and the picker go before the remote run answers, and the terminal has the keyboard", async () => {
    let finish!: (result: unknown) => void;
    const base = h.invoke.getMockImplementation()!;
    h.invoke.mockImplementation((command: string, args?: unknown) =>
      command === "execute_script"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : base(command, args),
    );
    await mount();
    await pickScript("Disk usage");
    await screen.findByTestId("app-prompt");
    const reviewed = reviewedText();
    expect(reviewed).toBe("df -h\ndu -sh /var/log");

    await confirmPrompt();
    expect(prompt()).not.toBeInTheDocument();
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()).toEqual([
      [
        "execute_script",
        { sessionId: "backend-flow-1", script: reviewed, interpreter: "bash" },
      ],
    ]);
    // The remote script has not answered yet. The picker is already gone and
    // typing goes to the terminal, not to the toolbar button the picker
    // handed the keyboard back to.
    await waitForPickerToClose();
    await waitFor(() => expect(document.activeElement).toBe(terminalInput()));
    expect(h.toast.error).not.toHaveBeenCalled();

    await act(async () => {
      finish({ stdout: "ok\n", stderr: "", exitCode: 0 });
    });
    await settle();
    expect(picker()).not.toBeInTheDocument();
    expect(sent()).toHaveLength(1);
    expect(document.activeElement).toBe(terminalInput());
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("sends a one-line script as the reviewed line plus Enter", async () => {
    await mount();
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    expect(reviewedText()).toBe("uptime");
    expect(preview()).toHaveTextContent("uptime");
    await confirmPrompt();
    await waitForPickerToClose();
    expect(sent()).toEqual([
      ["send_ssh_input", { sessionId: "backend-flow-1", data: "uptime\n" }],
    ]);
  });

  it("runs without a dialog when 'Confirm before running SSH scripts' is off, as before", async () => {
    h.settings = {
      ...defaultSettings,
      sessionQuickActions: {
        ...defaultSettings.sessionQuickActions,
        confirmBeforeScriptRun: false,
      },
    };
    await mount();
    await pickScript("Uptime");
    await waitForPickerToClose();
    expect(prompt()).not.toBeInTheDocument();
    expect(sent()).toEqual([
      ["send_ssh_input", { sessionId: "backend-flow-1", data: "uptime\n" }],
    ]);
    // The picker made way for the terminal here too.
    await waitFor(() => expect(document.activeElement).toBe(terminalInput()));
  });

  it("does not ask again for a remembered script until it is edited or the session reconnects", async () => {
    const view = await mount();
    const run = async (expectDialog: boolean, remember = false) => {
      await pickScript("Uptime");
      if (expectDialog) {
        await screen.findByTestId("app-prompt");
        if (remember) mouseClick(screen.getByTestId("app-prompt-remember"));
        await confirmPrompt();
      }
      await waitForPickerToClose();
      expect(prompt()).not.toBeInTheDocument();
    };

    // Confirmed with the box left alone: the next run asks again.
    await run(true);
    await run(true, true);
    expect(sent()).toHaveLength(2);
    // Remembered for this session: no dialog, and it still runs.
    await run(false);
    expect(sent()).toHaveLength(3);

    // The script is edited in the library: the answer no longer covers it.
    h.library.scripts = [diskUsage, { ...uptime, script: "uptime -p" }];
    view.rerender(<Tree />);
    await run(true, true);
    expect(sent()).toHaveLength(4);
    expect(sent()[3]).toEqual([
      "send_ssh_input",
      { sessionId: "backend-flow-1", data: "uptime -p\n" },
    ]);
    await run(false);
    expect(sent()).toHaveLength(5);

    // A reconnect is a new session, even with the same backend id.
    fireEvent.click(screen.getByTestId("terminal-reconnect"));
    await waitFor(() =>
      expect(
        h.invoke.mock.calls.filter(([command]) => command === "connect_ssh"),
      ).toHaveLength(2),
    );
    await waitFor(() =>
      expect(screen.getByText("Connected")).toBeInTheDocument(),
    );
    await run(true);
    expect(sent()).toHaveLength(6);
  });

  it("re-checks the library after the answer and sends nothing when the script changed meanwhile", async () => {
    await mount();
    await pickScript("Uptime");
    await screen.findByTestId("app-prompt");
    h.library.scripts = [diskUsage, { ...uptime, script: "rm -rf /tmp/x" }];
    await confirmPrompt();
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledOnce());
    await settle();
    expect(sent()).toEqual([]);
    // Nothing ran, so the picker is still there to pick again.
    expect(picker()).toBeInTheDocument();
    expect(h.terminal.focus).not.toHaveBeenCalled();
  });

  it("closes the dialog and sends nothing when the session drops while it is open", async () => {
    await mount();
    await waitFor(() => expect(h.listeners.has("ssh-shell-closed")).toBe(true));
    await pickScript("Disk usage");
    await screen.findByTestId("app-prompt");

    act(() => {
      h.listeners.get("ssh-shell-closed")!({
        payload: {
          session_id: "backend-flow-1",
          reason: "transport_error",
          recoverable: false,
          message: "fixture transport closed",
        },
      });
    });
    await waitFor(() => expect(prompt()).not.toBeInTheDocument());
    await settle();
    expect(sent()).toEqual([]);
    expect(getPromptSnapshot()).toHaveLength(0);
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("closes the dialog and sends nothing when the terminal goes away while it is open", async () => {
    const view = await mount();
    await pickScript("Disk usage");
    await screen.findByTestId("app-prompt");

    view.rerender(<Tree terminal={false} />);
    await waitFor(() => expect(prompt()).not.toBeInTheDocument());
    await settle();
    expect(sent()).toEqual([]);
    expect(getPromptSnapshot()).toHaveLength(0);
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("sends nothing and says so when the window has no prompt host", async () => {
    await mount({ host: false });
    await pickScript("Uptime");
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledOnce());
    expect(prompt()).not.toBeInTheDocument();
    expect(sent()).toEqual([]);
  });

  it("keeps the session's output arriving while the dialog is open", async () => {
    await mount();
    await waitFor(() => expect(h.listeners.has("ssh-output")).toBe(true));
    await pickScript("Disk usage");
    await screen.findByTestId("app-prompt");
    h.terminal.write.mockClear();

    act(() => {
      h.listeners.get("ssh-output")!({
        payload: {
          session_id: "backend-flow-1",
          data: "STREAMED",
          generation: 1,
          sequence_start: 0,
          sequence_end: 8,
          retained_start: 0,
          dropped_bytes: 0,
        },
      });
    });
    await waitFor(() =>
      expect(h.terminal.write).toHaveBeenCalledWith(
        "STREAMED",
        expect.any(Function),
      ),
    );
    expect(prompt()).toBeInTheDocument();
    expect(sent()).toEqual([]);
  });
});

describe("SSH terminal: replay a macro", () => {
  it("closes the macro list, then asks with the steps; confirm types exactly those steps", async () => {
    await mount();
    await pickMacro("Restart web");

    const expected = sshMacroReplayPrompt({
      macro: restartWeb,
      session: where,
      offerRemember: true,
    });
    const dialog = await screen.findByRole("dialog", { name: expected.title });
    // The list paints above every dialog, so it has to be gone first.
    expect(
      screen.queryByTestId("web-terminal-macro-popover"),
    ).not.toBeInTheDocument();
    expect(getPromptSnapshot()[0].request).toEqual(expected);
    expect(dialog).toHaveTextContent("Restart web");
    expect(dialog).toHaveTextContent("web-01");
    expect(preview()).toHaveTextContent("sudo systemctl restart nginx");
    expect(preview()).toHaveTextContent("systemctl is-active nginx");
    expect(screen.getByTestId("app-prompt-confirm")).toHaveTextContent(
      expected.confirmLabel,
    );
    expect(sent()).toEqual([]);

    await confirmPrompt();
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(sent()).toEqual([
      [
        "send_ssh_input",
        { sessionId: "backend-flow-1", data: "sudo systemctl restart nginx\n" },
      ],
      [
        "send_ssh_input",
        { sessionId: "backend-flow-1", data: "systemctl is-active nginx" },
      ],
    ]);
    // Its opener went with the list, so the keyboard goes to the terminal.
    await waitFor(() => expect(document.activeElement).toBe(terminalInput()));
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("draws one dialog however often a replay or a paste is requested meanwhile, and replays nothing on Cancel", async () => {
    await mount();
    await pickMacro("Restart web");
    await screen.findByTestId("app-prompt");

    await pickMacro("Restart web");
    await pasteText("first\nsecond");
    await settle();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByTestId("app-prompt-queue")).not.toBeInTheDocument();
    expect(getPromptSnapshot()).toHaveLength(1);

    await cancelPrompt();
    await settle();
    expect(prompt()).not.toBeInTheDocument();
    expect(sent()).toEqual([]);
    expect(h.toast.error).not.toHaveBeenCalled();
  });

  it("replays without a dialog when 'Confirm before replay' is off, as before", async () => {
    h.settings = {
      ...defaultSettings,
      macros: { ...defaultSettings.macros, confirmBeforeReplay: false },
    };
    await mount();
    await pickMacro("Restart web");
    await waitFor(() => expect(sent()).toHaveLength(2));
    expect(prompt()).not.toBeInTheDocument();
  });

  it("does not ask again for a remembered macro until its steps change", async () => {
    const view = await mount();
    await pickMacro("Restart web");
    await screen.findByTestId("app-prompt");
    mouseClick(screen.getByTestId("app-prompt-remember"));
    await confirmPrompt();
    await waitFor(() => expect(sent()).toHaveLength(2));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Replay Macro" }),
      ).toBeInTheDocument(),
    );

    await pickMacro("Restart web");
    await waitFor(() => expect(sent()).toHaveLength(4));
    expect(prompt()).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Replay Macro" }),
      ).toBeInTheDocument(),
    );

    h.library.macros = [
      {
        ...restartWeb,
        steps: [{ command: "sudo reboot", delayMs: 0, sendNewline: true }],
      },
    ];
    view.rerender(<Tree />);
    await pickMacro("Restart web");
    expect(await screen.findByTestId("app-prompt-preview")).toHaveTextContent(
      "sudo reboot",
    );
    expect(sent()).toHaveLength(4);
  });
});

describe("SSH terminal: paste multi-line or oversize text", () => {
  it("shows the text, pastes nothing on Cancel and pastes it once on Paste", async () => {
    await mount();
    await pasteText("echo one\necho two");

    const expected = terminalPastePrompt({
      text: "echo one\necho two",
      session: where,
      multiLine: true,
    });
    const dialog = await screen.findByRole("dialog", { name: expected.title });
    expect(getPromptSnapshot()[0].request).toEqual(expected);
    expect(dialog).toHaveTextContent("web-01");
    expect(preview()).toHaveTextContent("echo one");
    expect(preview()).toHaveTextContent("echo two");
    expect(screen.getByTestId("app-prompt-message")).toHaveTextContent(
      expected.message!,
    );
    // A paste is different text every time: there is nothing to remember.
    expect(screen.queryByTestId("app-prompt-remember")).not.toBeInTheDocument();
    expect(sent()).toEqual([]);

    await cancelPrompt();
    await settle();
    expect(prompt()).not.toBeInTheDocument();
    expect(sent()).toEqual([]);
    expect(h.toast.error).not.toHaveBeenCalled();

    await pasteText("echo one\necho two");
    await screen.findByTestId("app-prompt");
    const reviewed = reviewedText();
    expect(reviewed).toBe("echo one\necho two");
    await confirmPrompt();
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()).toEqual([
      ["send_ssh_input", { sessionId: "backend-flow-1", data: reviewed }],
    ]);
    await settle();
    expect(sent()).toHaveLength(1);
  });

  it("asks for the toolbar's Paste button too, with text from the fake clipboard", async () => {
    h.clipboard.readText.mockResolvedValue("line one\nline two");
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Paste" }));
    await screen.findByTestId("app-prompt");
    expect(reviewedText()).toBe("line one\nline two");
    expect(preview()).toHaveTextContent("line one");
    await confirmPrompt();
    await waitFor(() =>
      expect(sent()).toEqual([
        [
          "send_ssh_input",
          { sessionId: "backend-flow-1", data: "line one\nline two" },
        ],
      ]),
    );
  });

  it("asks for text over the configured length and says how far over", async () => {
    h.settings = {
      ...defaultSettings,
      warnOnMultiLinePaste: false,
      maxPasteLengthChars: 5,
    };
    await mount();
    await pasteText("12345");
    await settle();
    expect(prompt()).not.toBeInTheDocument();
    expect(sent()).toHaveLength(1);

    await pasteText("123456");
    // Asked for its length alone: it is one line.
    const expected = terminalPastePrompt({
      text: "123456",
      session: where,
      multiLine: false,
      lengthLimit: 5,
    });
    expect(await screen.findByTestId("app-prompt-message")).toHaveTextContent(
      expected.message!,
    );
    expect(getPromptSnapshot()[0].request).toEqual(expected);
    await cancelPrompt();
    await settle();
    expect(sent()).toHaveLength(1);
  });

  it("pastes without a dialog when the multi-line warning is off, as before", async () => {
    h.settings = {
      ...defaultSettings,
      warnOnMultiLinePaste: false,
      maxPasteLengthChars: 0,
    };
    await mount();
    await pasteText("echo one\necho two");
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(prompt()).not.toBeInTheDocument();
  });

  it("draws one dialog when a second paste arrives while the first is being reviewed", async () => {
    await mount();
    await pasteText("first\nsecond");
    await screen.findByTestId("app-prompt");
    await pasteText("third\nfourth");
    await settle();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(getPromptSnapshot()).toHaveLength(1);
    expect(reviewedText()).toBe("first\nsecond");
    expect(preview()).toHaveTextContent("first");
    expect(preview()).not.toHaveTextContent("third");
    await confirmPrompt();
    await waitFor(() => expect(sent()).toHaveLength(1));
    await settle();
    // Only the reviewed text was pasted; the second request was dropped.
    expect(sent()).toEqual([
      [
        "send_ssh_input",
        { sessionId: "backend-flow-1", data: "first\nsecond" },
      ],
    ]);
    expect(prompt()).not.toBeInTheDocument();
  });

  it("returns the keyboard to where the paste came from", async () => {
    await mount();
    const input = terminalInput();
    input.focus();

    await pasteText("echo one\necho two");
    await screen.findByTestId("app-prompt");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByTestId("app-prompt-confirm"),
      ),
    );
    await confirmPrompt();
    await settle();
    expect(document.activeElement).toBe(input);
    // The dialog already gave it back: the terminal does not grab it again.
    expect(h.terminal.focus).not.toHaveBeenCalled();
  });

  it("pastes nothing and says so when the window has no prompt host", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await mount({ host: false });
    await pasteText("echo one\necho two");
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        "Failed to confirm the terminal paste",
        3000,
      ),
    );
    expect(sent()).toEqual([]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("echo one");
    consoleError.mockRestore();
  });
});

describe("SSH terminal: two sessions that share a display name", () => {
  // The prompt names a session by its display name, and two sessions can have
  // the same one. Nothing may be merged, answered or remembered across them.
  const twin: ConnectionSession = { ...session, id: "flow-session-twin" };
  const CTRL_C = String.fromCharCode(3);

  const mountTwins = async () => {
    const base = h.invoke.getMockImplementation()!;
    let connects = 0;
    h.invoke.mockImplementation(async (command: string, args?: unknown) =>
      command === "connect_ssh"
        ? `backend-twin-${++connects}`
        : base(command, args),
    );
    render(
      <>
        <PromptHost />
        <div data-testid="first">
          <WebTerminal session={session} />
        </div>
        <div data-testid="second">
          <WebTerminal session={twin} />
        </div>
      </>,
    );
    await waitFor(() =>
      expect(screen.getAllByText("Connected")).toHaveLength(2),
    );
    const first = within(screen.getByTestId("first"));
    const second = within(screen.getByTestId("second"));

    // Which backend each view talks to, learned without any prompt: its own
    // Send Ctrl+C button.
    const backendOf = async (view: typeof first) => {
      h.invoke.mockClear();
      fireEvent.click(view.getByRole("button", { name: "Send Ctrl+C" }));
      await waitFor(() => expect(sent()).toHaveLength(1));
      const [, args] = sent()[0] as [
        string,
        { sessionId: string; data: string },
      ];
      expect(args.data).toBe(CTRL_C);
      return args.sessionId;
    };
    const firstBackend = await backendOf(first);
    const secondBackend = await backendOf(second);
    expect(firstBackend).not.toBe(secondBackend);
    h.invoke.mockClear();
    return { first, second, firstBackend, secondBackend };
  };

  const pasteInto = async (view: ReturnType<typeof within>, text: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => text },
    });
    await act(async () => {
      view.getByTestId("terminal-canvas").dispatchEvent(event);
      await Promise.resolve();
    });
  };
  const pickScriptIn = async (
    view: ReturnType<typeof within>,
    name: string,
  ) => {
    fireEvent.click(view.getByRole("button", { name: "Run Script" }));
    await waitFor(() => expect(picker()).toBeInTheDocument());
    fireEvent.click(screen.getByText(name).closest("button")!);
  };

  it("keeps their identical requests apart: each answer reaches only the session it was given for", async () => {
    const { first, second, firstBackend, secondBackend } = await mountTwins();
    expect(first.getAllByText("web-01").length).toBeGreaterThan(0);
    expect(second.getAllByText("web-01").length).toBeGreaterThan(0);

    // The same text into both: same title, same content, two prompts.
    await pasteInto(first, "echo one\necho two");
    await pasteInto(second, "echo one\necho two");
    await screen.findByTestId("app-prompt");
    expect(getPromptSnapshot()).toHaveLength(2);
    expect(getPromptSnapshot()[1].request).toEqual(
      getPromptSnapshot()[0].request,
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByTestId("app-prompt-queue")).toBeInTheDocument();

    // The first one is the first session's: confirming it pastes there only.
    await confirmPrompt();
    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()).toEqual([
      [
        "send_ssh_input",
        { sessionId: firstBackend, data: "echo one\necho two" },
      ],
    ]);

    // The second session's own prompt is still waiting for its own answer.
    await waitFor(() => expect(getPromptSnapshot()).toHaveLength(1));
    expect(await screen.findByTestId("app-prompt")).toBeInTheDocument();
    await cancelPrompt();
    await settle();
    expect(prompt()).not.toBeInTheDocument();
    expect(sent()).toHaveLength(1);
    expect(sent().some(([, args]) => args.sessionId === secondBackend)).toBe(
      false,
    );
  });

  it('remembers "Don\'t ask again" for one of them only', async () => {
    const { first, second, firstBackend, secondBackend } = await mountTwins();

    await pickScriptIn(first, "Uptime");
    await screen.findByTestId("app-prompt");
    mouseClick(screen.getByTestId("app-prompt-remember"));
    await confirmPrompt();
    await waitForPickerToClose();
    // Remembered on the first session: it runs again without a dialog.
    await pickScriptIn(first, "Uptime");
    await waitForPickerToClose();
    expect(prompt()).not.toBeInTheDocument();
    expect(sent()).toEqual([
      ["send_ssh_input", { sessionId: firstBackend, data: "uptime\n" }],
      ["send_ssh_input", { sessionId: firstBackend, data: "uptime\n" }],
    ]);

    // Same script, same name on the screen, another session: it asks.
    await pickScriptIn(second, "Uptime");
    expect(await screen.findByTestId("app-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("app-prompt-remember")).not.toBeChecked();
    await cancelPrompt();
    await settle();
    expect(sent()).toHaveLength(2);
    expect(sent().some(([, args]) => args.sessionId === secondBackend)).toBe(
      false,
    );
  });
});
